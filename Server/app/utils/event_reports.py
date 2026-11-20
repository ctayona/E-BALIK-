"""Isolated event reports. Never query or mutate campus item/claim/auction records."""
import logging
import re
from datetime import datetime, timezone
from uuid import uuid4
from app.utils.events import EventError, EventFoundation, event_id, _text, _date, CAMPUS_VENUES
from app.utils.event_lifecycle import EventLifecycle, parse, usable_profile
from app.utils.event_assets import EventAssets, normalize_artwork

MIGRATION = '20261116b_event_reports'
BUCKET = 'event-report-images'
CATEGORIES = ('Bags & Luggage', 'Electronics', 'Accessories', 'Personal Effects', 'Documents & Cards', 'Clothing', 'Keys', 'Valuables', 'Others')
REPORT_FIELDS = 'report_id,event_id,kind,item_name,category,description,venue,location_details,occurred_at,moderation_status,public_label,withdrawn_at,received_at,storage_location,version,created_at,updated_at,photo_path,reporter_account_id'
OWNER_FIELDS = tuple(key for key in REPORT_FIELDS.split(',') if key not in ('photo_path', 'reporter_account_id', 'storage_location'))
BOARD_FIELDS = ('report_id', 'kind', 'category', 'public_label', 'venue', 'occurred_at', 'received_at', 'created_at')
logger = logging.getLogger(__name__)


def report_payload(payload):
    keys = {'request_id', 'board_consent', 'kind', 'item_name', 'category', 'description', 'venue', 'location_details', 'occurred_at'}
    if not isinstance(payload, dict) or set(payload) != keys:
        raise EventError('Supply the event report form fields only.')
    if payload['board_consent'] is not True:
        raise EventError('Confirm consent for a generic event-only board listing before submitting.')
    result = {'board_consent': True, 'request_id': event_id(payload['request_id']), 'kind': payload['kind'], 'category': payload['category'], 'venue': payload['venue']}
    if result['kind'] not in ('missing', 'found') or result['category'] not in CATEGORIES or result['venue'] not in CAMPUS_VENUES:
        raise EventError('Choose an item type, category and university venue from the lists.')
    for key, maximum, minimum in (('item_name', 120, 3), ('description', 2000, 10), ('location_details', 300, 0)):
        result[key] = _text(payload[key], key.replace('_', ' '), maximum)
        if len(result[key]) < minimum:
            raise EventError(f'{key.replace("_", " ")} needs at least {minimum} characters.')
    result['occurred_at'] = _date(payload['occurred_at'])
    if not result['occurred_at']:
        raise EventError('Set when the item was lost or found.')
    return result


class EventReports:
    def __init__(self, db):
        self.db, self.client = db, db.client
        self.events, self.lifecycle = EventFoundation(db), EventLifecycle(db)

    def installed(self):
        return bool(self.events._execute(self.client.table('migration_log').select('name').eq('name', MIGRATION).limit(1)))

    def require_setup(self):
        if not self.installed():
            raise EventError('Event reporting requires 20261116b_event_reports.sql.', 503, 'event_reports_setup_required')

    def _rpc(self, name, params):
        self.require_setup()
        try:
            result = self.client.rpc(name, params).execute().data
        except Exception as error:
            if str(getattr(error, 'code', '')) in ('42883', 'PGRST202'):
                raise EventError('Event reporting setup is incomplete.', 503, 'event_reports_setup_required') from error
            raise
        if not isinstance(result, dict) or not result.get('ok'):
            raise EventError(result.get('error', 'Event request refused.') if isinstance(result, dict) else 'Invalid event service response.', 409, 'event_report_conflict')
        return result

    def event_for_slug(self, slug, include_deleted=False):
        if not isinstance(slug, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{2,79}', slug):
            raise EventError('Event page is unavailable.', 404, 'event_unavailable')
        rows = self.events._execute(self.client.table('event_workspaces').select('*').eq('slug', slug).limit(1))
        if not rows or (rows[0].get('deleted_at') and not include_deleted):
            raise EventError('Event page is unavailable.', 404, 'event_unavailable')
        return rows[0]

    @staticmethod
    def open(row, now=None):
        now = now or datetime.now(timezone.utc)
        return bool(not row.get('deleted_at') and row.get('portal_enabled') is True and row['status'] in ('active', 'recovery') and parse(row.get('starts_at')) and parse(row['starts_at']) <= now and parse(row.get('recovery_ends_at')) and now < parse(row['recovery_ends_at']))

    def attendee(self, account_id, event=None):
        profile = self.db.get_user_by_account_id(account_id)
        if not usable_profile(profile, datetime.now(timezone.utc)):
            raise EventError('Active account access required.', 403, 'event_access_denied')
        if profile.get('verification_status') != 'verified':
            # Explicit event assignment grants desk access without changing campus verification rules.
            try:
                if not event:
                    raise EventError('Verification required.', 403)
                self.lifecycle.authorize_workspace(event['event_id'], account_id)
            except EventError:
                raise EventError('Verify your E-Balik account in Profile before using event reporting.', 403, 'verification_required') from None

    def portal(self, slug):
        self.require_setup()
        row = self.event_for_slug(slug)
        if not self.open(row):
            raise EventError('This event page is not open. Contact the event organizer.', 404, 'event_unavailable')
        safe = {key: row.get(key) for key in ('event_id', 'name', 'slug', 'organizer_name', 'venue', 'desk_instructions', 'starts_at', 'ends_at', 'recovery_ends_at', 'status', 'branding')}
        return {'event': safe, 'claims_available': self.recovery_installed(), 'artwork': EventAssets(self.db).list(row['event_id']), 'venues': list(CAMPUS_VENUES), 'categories': list(CATEGORIES), 'claims_available': self.recovery_installed()}

    def workspace(self, identifier, account_id):
        result = self.lifecycle.authorize_workspace(identifier, account_id)
        row = self.events.get(identifier)
        installed = self.installed()
        result['claims_available'] = self.recovery_installed()
        result['operations_available'] = bool(self.events._execute(self.client.table('migration_log').select('name').eq('name', '20261118_event_pilot_completion').limit(1)))
        result.update(reports_available=installed, reporting_enabled=self.open(row), portal_url=f'/events/{row["slug"]}', categories=list(CATEGORIES), venues=list(CAMPUS_VENUES))
        if installed:
            result['permissions'] += ['view_reports', 'receive_reports', 'add_notes'] + (['review_reports'] if result['role'] == 'manager' else [])
        return result

    def set_portal(self, identifier, payload, actor_id):
        if not isinstance(payload, dict) or set(payload) != {'enabled', 'version', 'note'} or not isinstance(payload['enabled'], bool):
            raise EventError('Supply enabled, version and a reason.')
        self._version(payload['version'])
        note = _text(payload['note'], 'Reason', 1000, True)
        if len(note) < 5:
            raise EventError('Enter a reason of at least five characters.')
        return self._rpc('event_set_portal', dict(p_event_id=event_id(identifier), p_actor_id=event_id(actor_id), p_version=payload['version'], p_enabled=payload['enabled'], p_note=note))['event']

    @staticmethod
    def _version(value):
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise EventError('Supply the current report version.')

    @staticmethod
    def owner_view(row):
        return {**{key: row.get(key) for key in OWNER_FIELDS}, 'released_at': row.get('released_at'), 'has_photo': bool(row.get('photo_path')), 'reference': 'EV-' + row['report_id'][:8].upper()}

    def recovery_installed(self):
        return bool(self.events._execute(self.client.table('migration_log').select('name').eq('name', '20261116c_event_recovery').limit(1)))

    def alerts_installed(self):
        return bool(self.events._execute(self.client.table('migration_log').select('name').eq('name', '20261117_event_match_alerts').limit(1)))

    def columns(self):
        return REPORT_FIELDS + (',released_at' if self.recovery_installed() else '')

    def board(self, slug, account_id, offset=0):
        self.require_setup()
        row = self.event_for_slug(slug)
        if not self.open(row):
            raise EventError('Event browsing is closed.', 404, 'event_unavailable')
        self.attendee(account_id, row)
        query = self.client.table('event_reports').select(','.join(BOARD_FIELDS)).eq('event_id', row['event_id']).eq('moderation_status', 'approved').is_('withdrawn_at', 'null')
        if self.recovery_installed():
            query = query.is_('released_at', 'null')
        reports = self.events._execute(query.order('created_at', desc=True).order('report_id').range(offset, offset + 23))
        return [{**{key: r.get(key) for key in BOARD_FIELDS}, 'reference': 'EV-' + r['report_id'][:8].upper()} for r in reports]

    def mine(self, slug, account_id, offset=0):
        self.require_setup()
        row = self.event_for_slug(slug, include_deleted=True)
        reports = self.events._execute(self.client.table('event_reports').select(self.columns()).eq('event_id', row['event_id']).eq('reporter_account_id', account_id).order('created_at', desc=True).order('report_id').range(offset, offset + 23))
        # Owners can read their reports after closure; never return private event configuration.
        return {'reports': [self.owner_view(r) for r in reports]}

    def create(self, identifier, payload, account_id, photo=None):
        self.require_setup()
        data = report_payload(payload)
        row = self.events.get(identifier)
        self.attendee(account_id, row)
        old = self.events._execute(self.client.table('event_reports').select(self.columns()).eq('event_id', row['event_id']).eq('reporter_account_id', account_id).eq('request_id', data['request_id']).limit(1))
        if old:
            return self.owner_view(old[0])
        # Check before upload, then repeat authoritatively inside the atomic database command.
        if not self.open(row):
            self.lifecycle.authorize_workspace(identifier, account_id)
            if row['status'] not in ('active', 'recovery'):
                raise EventError('Start the event before recording reports.', 409, 'event_closed')
        incident = parse(data['occurred_at'])
        now = datetime.now(timezone.utc)
        if not (parse(row['starts_at']) <= incident <= min(now, parse(row['ends_at']))):
            raise EventError('The incident must occur during the event and cannot be in the future.')
        report_id, path = str(uuid4()), None
        if photo is not None:
            content = normalize_artwork(photo, 'banner')
            path = f'{row["event_id"]}/{report_id}/{uuid4().hex}.webp'
            self.client.storage.from_(BUCKET).upload(path, content, {'content-type': 'image/webp', 'upsert': 'false', 'cache-control': '0'})
        data['photo_path'] = path
        try:
            result = self._rpc('event_report_command', dict(p_event_id=row['event_id'], p_actor_id=event_id(account_id), p_report_id=report_id, p_action='create', p_version=None, p_data=data))
        except EventError:
            if path:
                self._remove_unreferenced(path)
            raise
        # On a network/unknown error, retain the object: the transaction might have committed.
        # A retry with the same request_id returns the committed row instead of duplicating it.
        if path and result['report'].get('photo_path') != path:
            self._remove_unreferenced(path)
        return self.owner_view(result['report'])

    def _remove_unreferenced(self, path):
        try:
            used = self.events._execute(self.client.table('event_reports').select('report_id').eq('photo_path', path).limit(1))
            if not used:
                self.client.storage.from_(BUCKET).remove([path])
        except Exception:
            logger.warning('Unreferenced event photo retained after failed cleanup.')

    def queue(self, identifier, account_id, offset=0):
        self.require_setup()
        self.lifecycle.authorize_workspace(identifier, account_id)
        rows = self.events._execute(self.client.table('event_reports').select(self.columns()).eq('event_id', event_id(identifier)).order('created_at', desc=True).order('report_id').range(offset, offset + 23))
        return [self.owner_view(r) for r in rows]

    def detail(self, identifier, report_id, account_id):
        self.require_setup()
        # Authorize staff first so a caller cannot enumerate another event's reports.
        self.lifecycle.authorize_workspace(identifier, account_id)
        row = self._row(identifier, report_id)
        history = self.events._execute(self.client.table('event_report_history').select('history_id,action,note,created_at').eq('event_id', event_id(identifier)).eq('report_id', event_id(report_id)).order('created_at', desc=True).limit(100))
        return {'report': {**self.owner_view(row), 'storage_location': row.get('storage_location')}, 'history': history}

    def _row(self, identifier, report_id):
        rows = self.events._execute(self.client.table('event_reports').select(self.columns()).eq('event_id', event_id(identifier)).eq('report_id', event_id(report_id)).limit(1))
        if not rows:
            raise EventError('Event report not found.', 404, 'event_report_not_found')
        return rows[0]

    def action(self, identifier, report_id, payload, account_id):
        if not isinstance(payload, dict) or set(payload) != {'action', 'version', 'data'} or payload['action'] not in ('approve', 'hide', 'receive', 'note', 'withdraw') or not isinstance(payload['data'], dict):
            raise EventError('Choose an available event desk action.')
        self._version(payload['version'])
        action, data = payload['action'], payload['data']
        if self.recovery_installed() and self._row(identifier, report_id).get('released_at') and action != 'note':
            raise EventError('Released report facts cannot be changed.', 409, 'event_report_released')
        if action != 'withdraw':
            workspace = self.lifecycle.authorize_workspace(identifier, account_id)
            if action in ('approve', 'hide') and workspace['role'] != 'manager':
                raise EventError('Event manager access required to review reports.', 403, 'event_access_denied')
            allowed = {'note', 'public_label'} if action in ('approve', 'hide') else {'note', 'storage_location'} if action == 'receive' else {'note'}
            if set(data) - allowed or 'note' not in data:
                raise EventError('Supply the fields for this action only.')
            data = {key: _text(value, key.replace('_', ' '), 1000 if key == 'note' else 160 if key == 'storage_location' else 120) for key, value in data.items()}
            if len(data['note']) < 5:
                raise EventError('Enter a note of at least five characters.')
            if action == 'approve' and (len(data.get('public_label', '')) < 3 or re.search(r'@|\d{6,}', data['public_label'])):
                raise EventError('Enter a generic public item label without personal names, IDs, phone numbers or email addresses.')
            if action == 'receive' and len(data.get('storage_location', '')) < 3:
                raise EventError('Enter the actual desk storage location.')
        elif data:
            raise EventError('Withdrawal needs no additional fields.')
        result = self._rpc('event_report_command', dict(p_event_id=event_id(identifier), p_actor_id=event_id(account_id), p_report_id=event_id(report_id), p_action=action, p_version=payload['version'], p_data=data))
        return self.owner_view(result['report'])

    def photo(self, identifier, report_id, account_id):
        self.require_setup()
        row = self._row(identifier, report_id)
        if row.get('reporter_account_id') != account_id:
            self.lifecycle.authorize_workspace(identifier, account_id)
        path = row.get('photo_path')
        if not path:
            raise EventError('No report photo is available.', 404)
        if not re.fullmatch(rf'{re.escape(event_id(identifier))}/{re.escape(event_id(report_id))}/[0-9a-f]{{32}}\.webp', path):
            raise EventError('Invalid event photo path.', 409)
        return self.client.storage.from_(BUCKET).download(path)
