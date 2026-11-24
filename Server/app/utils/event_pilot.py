"""University pilot publication, closing snapshots and acknowledged custody. Event-only writes."""
import csv
import io
import re
import zipfile
from datetime import datetime, timezone
from app.utils.events import EventError, event_id, _text
from app.utils.event_lifecycle import usable_profile, parse
from app.utils.event_reports import EventReports, BOARD_FIELDS
from app.utils.event_tags import EventTags

MIGRATION = '20261118_event_pilot_completion'
OFFICE_ROLES = ('guard', 'admin', 'super_admin')
REGISTER_FIELDS = ('reference', 'kind', 'item_name', 'category', 'venue', 'occurred_at', 'received_at', 'released_at', 'moderation_status', 'storage_location', 'transfer_status', 'receiver_name', 'destination', 'destination_storage', 'accepted_at')


def csv_bytes(fields, rows):
    output = io.StringIO(newline='')
    writer = csv.writer(output); writer.writerow(fields)
    for row in rows:
        cells = []
        for field in fields:
            value = str(row.get(field) if row.get(field) is not None else '')
            if value.lstrip().startswith(('=', '+', '-', '@', '\t', '\r', '\n')):
                value = "'" + value
            cells.append(value)
        writer.writerow(cells)
    return output.getvalue().encode('utf-8-sig')


class EventPilot:
    def __init__(self, db):
        self.db, self.client = db, db.client
        self.reports = EventReports(db)
        self.events, self.lifecycle = self.reports.events, self.reports.lifecycle

    def installed(self):
        return bool(self.events._execute(self.client.table('migration_log').select('name').eq('name', MIGRATION).limit(1)))

    def require_setup(self):
        if not self.installed():
            raise EventError('Event pilot completion migration is required.', 503, 'event_pilot_setup_required')

    def profile(self, actor, verified=False):
        person = self.db.get_user_by_account_id(actor) if actor else None
        if not usable_profile(person, datetime.now(timezone.utc)) or verified and person.get('verification_status') != 'verified':
            raise EventError('Active verified event access required.', 403, 'verification_required')
        return person

    def authorize(self, identifier, actor, admin=False):
        person = self.profile(actor)
        if person.get('access_level') == 'super_admin':
            return self.events.get(identifier, include_deleted=True)
        if admin:
            raise EventError('E-Balik super administrator access required.', 403)
        workspace = self.lifecycle.authorize_workspace(identifier, actor)
        if workspace['role'] != 'manager':
            raise EventError('Event manager access required for the closing register.', 403)
        return self.events.get(identifier)

    def rpc(self, name, params):
        self.require_setup()
        try:
            value = self.client.rpc(name, params).execute().data
        except Exception as error:
            if getattr(error,'code',None)=='P0001' and getattr(error,'message','').startswith('Resolve Event items'):
                raise EventError('Resolve pending check-ins and held event items before final sign-off, archive or deletion.',409) from error
            if str(getattr(error, 'code', '')) in ('42883', 'PGRST202'):
                raise EventError('Event pilot setup is incomplete.', 503, 'event_pilot_setup_required') from error
            raise
        if not isinstance(value, dict) or value.get('ok') is False:
            raise EventError(value.get('error', 'Event operation refused.') if isinstance(value, dict) else 'Invalid event response.', 409, 'event_pilot_conflict')
        return value

    @staticmethod
    def version(value, zero=False):
        if type(value) is not int or not (0 if zero else 1) <= value <= 2147483647:
            raise EventError('Supply the current reviewed version.')
        return value

    def own_consent(self, identifier, report_id, actor):
        self.require_setup(); self.profile(actor, verified=True)
        row = self.reports._row(identifier, report_id)
        if row.get('reporter_account_id') != actor:
            raise EventError('Only your own report has hub permission controls.', 403)
        entries = self.events._execute(self.client.table('event_hub_consents').select('allowed,version').eq('event_id', row['event_id']).eq('report_id', row['report_id']).eq('account_id', actor).limit(1))
        return {'allowed': bool(entries and entries[0]['allowed']), 'version': entries[0]['version'] if entries else 0, 'reference': 'EV-' + row['report_id'][:8].upper()}

    def consent(self, identifier, report_id, actor, payload):
        self.own_consent(identifier, report_id, actor)
        if not isinstance(payload, dict) or set(payload) != {'version', 'allowed'} or type(payload['allowed']) is not bool:
            raise EventError('Choose allow or revoke for your report only.')
        self.version(payload['version'], zero=True)
        self.rpc('event_pilot_command', dict(p_event_id=event_id(identifier), p_actor_id=event_id(actor), p_action='consent', p_data={**payload, 'report_id': event_id(report_id)}))
        return self.own_consent(identifier, report_id, actor)

    def recovery_info(self, slug, actor):
        self.profile(actor, verified=True)
        if not self.installed(): return {'available': False}
        event = self.reports.event_for_slug(slug, include_deleted=True)
        if event['status'] in ('draft', 'scheduled'):
            raise EventError('Event recovery information is unavailable.', 404, 'event_unavailable')
        plan = self.events._execute(self.client.table('event_closure_plans').select('instructions,completed_at').eq('event_id', event['event_id']).limit(1))
        return {'available': True, 'instructions': plan[0]['instructions'] if plan else '', 'completed_at': plan[0].get('completed_at') if plan else None}

    def hub(self, actor, offset=0, kind='all', search=''):
        self.profile(actor, verified=True)
        if not self.installed(): return {'available': False, 'publications': [], 'has_more': False}
        self.page(offset)
        if kind not in ('all', 'missing', 'found'): raise EventError('Choose a report type.')
        search = _text(search, 'Search', 100)
        result = self.rpc('event_pilot_feed', dict(p_actor_id=event_id(actor), p_offset=offset, p_kind=kind, p_search=search))
        # The SQL projection is an allow-list; retain only that contract here as defense in depth.
        fields = ('publication_id', 'published_at', 'event_id', 'event_name', 'slug', *BOARD_FIELDS)
        result['publications'] = [{**{key: row.get(key) for key in fields}, 'reference': 'EV-' + row['report_id'][:8].upper()} for row in result.get('publications', [])]
        return {'available': True, 'publications': result['publications'], 'has_more': bool(result.get('has_more'))}

    @staticmethod
    def page(offset):
        if type(offset) is not int or not 0 <= offset <= 100000: raise EventError('Invalid event register page.')

    def hub_detail(self, publication_id, actor):
        self.profile(actor, verified=True); self.require_setup()
        publications = self.events._execute(self.client.table('event_hub_publications').select('event_id,report_id,consent_version,listing_snapshot').eq('publication_id', event_id(publication_id)).eq('status', 'published').limit(1))
        if not publications: raise EventError('This event listing is no longer published.', 404)
        pub = publications[0]; event = self.events.get(pub['event_id'])
        report = self.reports._row(event['event_id'], pub['report_id'])
        consent = self.events._execute(self.client.table('event_hub_consents').select('allowed,account_id,version').eq('event_id', event['event_id']).eq('report_id', report['report_id']).limit(1))
        saved = pub.get('listing_snapshot') or {}
        current_projection = all(saved.get(key) == report.get(key) for key in ('kind', 'category', 'public_label', 'venue')) and parse(saved.get('occurred_at')) == parse(report.get('occurred_at'))
        if not (current_projection and self.reports.open(event) and report['moderation_status'] == 'approved' and report.get('board_consent') is True and not report.get('released_at') and not report.get('withdrawn_at') and report.get('reporter_account_id') and consent and consent[0]['allowed'] and consent[0]['account_id'] == report['reporter_account_id'] and consent[0]['version'] == pub.get('consent_version')):
            raise EventError('This event listing is no longer available.', 404)
        return {'slug': event['slug'], 'listing': {**{key: report.get(key) for key in BOARD_FIELDS}, 'reference': 'EV-' + report['report_id'][:8].upper()}, 'can_claim': report['kind'] == 'found' and report.get('reporter_account_id') != actor}

    def snapshot(self, identifier, actor, offset=0, view='all', limit=24):
        event = self.authorize(identifier, actor)
        if not self.installed(): return {'available': False}
        self.page(offset)
        if view not in ('all', 'unresolved', 'custody'): raise EventError('Choose an event register view.')
        result = self.rpc('event_pilot_snapshot', dict(p_event_id=event['event_id'], p_actor_id=event_id(actor), p_offset=offset, p_limit=limit + 1, p_filter=view))
        tags = EventTags(self.db)
        if tags.mode() != 'off':
            result['counts'].update(self.client.rpc('event_tag_counts',{'p_event':identifier}).execute().data)
        rows = result.get('reports', [])
        result.update(available=True, event={key: event.get(key) for key in ('event_id', 'name', 'slug', 'status', 'deleted_at', 'recovery_ends_at')}, has_more=len(rows) > limit)
        result['reports'] = [{**row, 'reference': 'EV-' + row['report_id'][:8].upper()} for row in rows[:limit]]
        return result

    def preview(self, identifier, report_id, actor):
        event = self.authorize(identifier, actor, admin=True); self.require_setup()
        row = self.reports._row(identifier, report_id)
        consent = self.events._execute(self.client.table('event_hub_consents').select('allowed,account_id,version').eq('event_id', event['event_id']).eq('report_id', row['report_id']).limit(1))
        publication = self.events._execute(self.client.table('event_hub_publications').select('status,version').eq('event_id', event['event_id']).eq('report_id', row['report_id']).limit(1))
        allowed = bool(consent and consent[0]['allowed'] and row.get('reporter_account_id') and consent[0]['account_id'] == row['reporter_account_id'])
        eligible = bool(allowed and self.reports.open(event) and row['moderation_status'] == 'approved' and row['board_consent'] is True and not row.get('withdrawn_at') and not row.get('released_at'))
        return {'listing': {**{key: row.get(key) for key in BOARD_FIELDS}, 'reference': 'EV-' + row['report_id'][:8].upper()}, 'event_name': event['name'], 'report_version': row['version'], 'consent_version': consent[0]['version'] if consent else 0, 'version': publication[0]['version'] if publication else 0, 'status': publication[0]['status'] if publication else 'private', 'can_publish': eligible, 'hub_allowed': allowed}

    def command(self, identifier, actor, action, payload):
        self.authorize(identifier, actor, admin=True); self.require_setup()
        fields = {
            'publish': {'report_id', 'report_version', 'consent_version', 'version', 'note'},
            'unpublish': {'report_id', 'report_version', 'consent_version', 'version', 'note'},
            'closure_save': {'version', 'instructions', 'note', 'acknowledged'},
            'closure_complete': {'version', 'instructions', 'note', 'acknowledged'},
            'transfer_request': {'report_id', 'report_version', 'receiver_id', 'request_id', 'note'},
            'transfer_cancel': {'transfer_id', 'version', 'note'},
        }
        if not isinstance(action, str) or action not in fields or not isinstance(payload, dict) or set(payload) != fields[action]: raise EventError('Supply only the reviewed event operation fields.')
        data = dict(payload)
        for key in ('report_id', 'receiver_id', 'request_id', 'transfer_id'):
            if key in data: data[key] = event_id(data[key])
        for key in ('report_version', 'consent_version', 'version'):
            if key in data: self.version(data[key], zero=key != 'report_version')
        data['note'] = _text(data['note'], 'Reason', 1000, True)
        if len(data['note']) < 5: raise EventError('Enter a reason of at least five characters.')
        if 'instructions' in data:
            data['instructions'] = _text(data['instructions'], 'Final recovery instructions', 1000, True)
            if type(data['acknowledged']) is not bool: raise EventError('Confirm the closing acknowledgement.')
        return self.rpc('event_pilot_command', dict(p_event_id=event_id(identifier), p_actor_id=event_id(actor), p_action=action, p_data=data))

    def receiver_lookup(self, identifier, actor, email):
        self.authorize(identifier, actor, admin=True); self.require_setup()
        if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email.strip()): raise EventError('Enter an exact office staff email.')
        people = self.events._execute(self.client.table('user_profiles').select('account_id,fname,lname,is_active,suspended_until,access_level').eq('email', email.strip().lower()).limit(1))
        if not people or not usable_profile(people[0], datetime.now(timezone.utc)) or people[0].get('access_level') not in OFFICE_ROLES or people[0]['account_id'] == actor:
            raise EventError('Choose a different active university office staff account.', 404)
        return {key: people[0].get(key) for key in ('account_id', 'fname', 'lname')}

    def incoming(self, actor, offset=0):
        profile = self.profile(actor); self.page(offset)
        if not self.installed(): return {'available': False, 'transfers': [], 'has_more': False}
        if profile.get('access_level') not in OFFICE_ROLES: return {'available': True, 'transfers': [], 'has_more': False}
        fields = 'transfer_id,event_id,report_id,receiver_name,destination,source_location,destination_storage,status,version,created_at,accepted_at'
        rows = self.events._execute(self.client.table('event_custody_transfers').select(fields).eq('receiver_id', actor).in_('status', ['pending', 'accepted']).order('created_at', desc=True).order('transfer_id').range(offset, offset + 24))
        # Receiving staff receive only their own handover, not general event report/claim access.
        ids = list({row['event_id'] for row in rows})
        events = self.events._execute(self.client.table('event_workspaces').select('event_id,name').in_('event_id', ids)) if ids else []
        names = {row['event_id']: row['name'] for row in events}
        return {'available': True, 'transfers': [{**{key: row.get(key) for key in fields.split(',')}, 'event_name': names.get(row['event_id'], 'Event'), 'reference': 'EV-' + row['report_id'][:8].upper()} for row in rows[:24]], 'has_more': len(rows) > 24}

    def accept(self, identifier, actor, payload):
        if self.profile(actor).get('access_level') not in OFFICE_ROLES: raise EventError('Receiving office staff access required.', 403)
        if not isinstance(payload, dict) or set(payload) != {'transfer_id', 'version', 'storage', 'identity_checked'} or payload['identity_checked'] is not True:
            raise EventError('Confirm physical receipt and the receiving storage position.')
        self.version(payload['version'])
        data = {**payload, 'transfer_id': event_id(payload['transfer_id']), 'storage': _text(payload['storage'], 'Storage', 160, True)}
        if len(data['storage']) < 3: raise EventError('Enter a receiving storage position of at least three characters.')
        return self.rpc('event_pilot_command', dict(p_event_id=event_id(identifier), p_actor_id=event_id(actor), p_action='transfer_accept', p_data=data))

    def export(self, identifier, actor):
        data = self.snapshot(identifier, actor, view='all', limit=5000)
        if not data['available']: self.require_setup()
        if data['has_more']: raise EventError('This event exceeds the pilot export limit of 5000 reports. No partial export was produced.', 413)
        summary = [{'metric': 'event', 'value': data['event']['name']}, {'metric': 'generated_at_utc', 'value': data['generated_at']}]
        summary += [{'metric': key, 'value': value} for key, value in data['counts'].items()]
        summary += [{'metric': 'claims_' + key, 'value': value} for key, value in data['claims'].items()]
        summary += [{'metric': 'closure_signed_off', 'value': (data.get('closure') or {}).get('completed_at') or 'Pending'}]
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            if 'tag_pending' in data['counts']:
                tags = EventTags(self.db)
                fields = ('registration_id','code','status','created_at','received_at','released_at','report_id')
                records = []
                for offset in range(0, 5001, 250):
                    page = tags.rows(tags.table('_registrations').select(','.join(fields)).eq('event_id',identifier).order('created_at').order('registration_id').range(offset,offset+249))
                    records.extend(page)
                    if len(records)>5000: raise EventError('Event item export exceeds 5000 registrations.',413)
                    if len(page)<250: break
                archive.writestr('event-tag-custody.csv', csv_bytes(fields,records))
                ids = [r['registration_id'] for r in records]
                transfers = []
                for offset in range(0,len(ids),50):
                    for start in range(0,5001,250):
                        page = tags.rows(tags.table('_transfers').select('transfer_id,registration_id,destination,created_at,accepted_at,cancelled_at').in_('registration_id',ids[offset:offset+50]).order('transfer_id').range(start,start+249))
                        transfers.extend(page)
                        if len(transfers)>5000: raise EventError('Event handover export exceeds 5000 records.',413)
                        if len(page)<250: break
                archive.writestr('event-tag-handovers.csv', csv_bytes(('transfer_id','registration_id','destination','created_at','accepted_at','cancelled_at'),transfers))
            archive.writestr('summary.csv', csv_bytes(('metric', 'value'), summary))
            archive.writestr('event-register.csv', csv_bytes(REGISTER_FIELDS, data['reports']))
            archive.writestr('unresolved-custody.csv', csv_bytes(REGISTER_FIELDS, [r for r in data['reports'] if r.get('received_at') and not r.get('released_at')]))
        return output.getvalue()
