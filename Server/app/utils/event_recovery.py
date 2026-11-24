"""Event-only recovery and recoverable workspace administration."""
import hashlib
import hmac
import re
from datetime import datetime, timezone
from uuid import uuid4
from app.utils.events import EventError, EventFoundation, event_id, _text
from app.utils.event_lifecycle import EventLifecycle, parse
from app.utils.event_reports import EventReports, BUCKET
from app.utils.event_assets import normalize_artwork
from app.utils.crypto_service import CryptoService
from app.utils.handover import generate_pin, PIN_ALPHABET, PIN_LENGTH

MIGRATION = '20261116c_event_recovery'
CLAIM_FIELDS = ('claim_id', 'event_id', 'report_id', 'status', 'evidence', 'decision_note', 'pickup_expires_at', 'pin_issued_at', 'failed_attempts', 'released_at', 'version', 'created_at')


class EventRecovery:
    def __init__(self, db):
        self.db, self.client = db, db.client
        self.events, self.reports, self.lifecycle = EventFoundation(db), EventReports(db), EventLifecycle(db)

    def installed(self):
        return bool(self.events._execute(self.client.table('migration_log').select('name').eq('name', MIGRATION).limit(1)))

    def require_setup(self):
        if not self.installed():
            raise EventError('Run 20261116c_event_recovery.sql to enable claims and event management.', 503, 'event_recovery_setup_required')

    def rpc(self, name, params):
        self.require_setup()
        try:
            result = self.client.rpc(name, params).execute().data
        except Exception as error:
            if getattr(error,'code',None)=='P0001' and getattr(error,'message','').startswith('Resolve Event items'):
                raise EventError('Resolve pending check-ins and held event items before final sign-off, archive or deletion.',409) from error
            if str(getattr(error, 'code', '')) in ('42883', 'PGRST202'):
                raise EventError('Event recovery setup is incomplete.', 503, 'event_recovery_setup_required') from error
            raise
        if not isinstance(result, dict) or not result.get('ok'):
            raise EventError(result.get('error', 'Event recovery action refused.') if isinstance(result, dict) else 'Invalid recovery response.', 409, result.get('code', 'event_recovery_conflict') if isinstance(result, dict) else 'event_recovery_conflict')
        return result

    def list_events(self, offset, view):
        filters = {'all': None, 'drafts': ['draft'], 'open': ['scheduled', 'active', 'recovery'], 'closed': ['closed', 'cancelled'], 'archived': ['archived'], 'deleted': None}
        if view not in filters:
            raise EventError('Choose an available event list.')
        available = self.installed()
        if view == 'deleted' and not available:
            return [], available
        query = self.client.table('event_workspaces').select('*')
        if available:
            query = query.not_.is_('deleted_at', 'null') if view == 'deleted' else query.is_('deleted_at', 'null')
        if filters[view]:
            query = query.in_('status', filters[view])
        return self.events._execute(query.order('created_at', desc=True).range(offset, offset + 49)), available

    def manage(self, identifier, payload, actor):
        if not isinstance(payload, dict) or set(payload) != {'action', 'version', 'note'} or payload['action'] not in ('archive', 'delete', 'restore'):
            raise EventError('Choose archive, delete or restore and enter a reason.')
        self.reports._version(payload['version'])
        note = _text(payload['note'], 'Reason', 1000, True)
        if len(note) < 5:
            raise EventError('Enter a reason of at least five characters.')
        current = self.events.get(identifier, include_deleted=True)
        if payload['action'] == 'delete' and current['status'] != 'archived':
            raise EventError('Archive the event first. Delete is available from Archived.', 409)
        if payload['action'] == 'archive' and current['status'] == 'draft':
            return self.rpc('admin_archive_draft_event', dict(p_event_id=event_id(identifier), p_actor_id=event_id(actor),
                            p_version=payload['version'], p_note=note))['event']
        if payload['action'] == 'restore' and current['status'] == 'archived' and current.get('deleted_at') is None:
            return self.rpc('admin_restore_archived_event', dict(p_event_id=event_id(identifier), p_actor_id=event_id(actor),
                            p_version=payload['version'], p_note=note))['event']
        return self.rpc('event_manage_workspace', dict(p_event_id=event_id(identifier), p_actor_id=event_id(actor), p_version=payload['version'], p_action=payload['action'], p_note=note))['event']

    @staticmethod
    def pin_hash(identifier, pin):
        return hmac.new(CryptoService._get_key(), f'event-pickup:{event_id(identifier)}:{pin}'.encode(), hashlib.sha256).hexdigest()

    def _claim(self, identifier, claim_id):
        self.require_setup()
        rows = self.events._execute(self.client.table('event_claims').select('*').eq('event_id', event_id(identifier)).eq('claim_id', event_id(claim_id)).limit(1))
        if not rows:
            raise EventError('Event claim not found.', 404, 'event_claim_not_found')
        return rows[0]

    def view(self, row, owner=False):
        value = {key: row.get(key) for key in CLAIM_FIELDS}
        value.update(reference='EC-' + row['claim_id'][:8].upper(), has_proof=bool(row.get('proof_path')))
        if row['status'] == 'approved' and parse(row.get('pickup_expires_at')) and parse(row['pickup_expires_at']) <= datetime.now(timezone.utc):
            value['status'] = 'expired'
        if owner and value['status'] == 'approved':
            value['pickup_code'] = CryptoService.decrypt(row.get('pin_encrypted')) if row.get('failed_attempts', 0) < 5 else None
            value['pickup_locked'] = row.get('failed_attempts', 0) >= 5
        if not owner:
            person = self.db.get_user_by_account_id(row.get('claimant_account_id')) if row.get('claimant_account_id') else None
            value['claimant_name'] = ' '.join(str((person or {}).get(key) or '') for key in ('fname', 'lname')).strip() or 'Claimant account unavailable'
        report = self.reports._row(row['event_id'], row['report_id'])
        value['item_label'] = row.get('receipt_item_label') or report.get('public_label') or report.get('category')
        return value

    def mine(self, slug, actor, offset=0):
        self.require_setup()
        event = self.reports.event_for_slug(slug, include_deleted=True)
        rows = self.events._execute(self.client.table('event_claims').select('*').eq('event_id', event['event_id']).eq('claimant_account_id', actor).order('created_at', desc=True).range(offset, offset + 23))
        return [self.view(row, owner=True) for row in rows]

    def queue(self, identifier, actor, report_id=None, offset=0):
        self.require_setup()
        self.lifecycle.authorize_workspace(identifier, actor)
        query = self.client.table('event_claims').select('*').eq('event_id', event_id(identifier))
        if report_id:
            query = query.eq('report_id', event_id(report_id))
        rows = self.events._execute(query.order('created_at', desc=True).range(offset, offset + 23))
        return [self.view(row) for row in rows]

    def detail(self, identifier, claim_id, actor):
        self.lifecycle.authorize_workspace(identifier, actor)
        row = self._claim(identifier, claim_id)
        history = self.events._execute(self.client.table('event_claim_history').select('history_id,action,note,created_at').eq('event_id', event_id(identifier)).eq('claim_id', event_id(claim_id)).order('created_at', desc=True).limit(100))
        return {'claim': self.view(row), 'history': history}

    def create(self, identifier, payload, actor, photo=None):
        self.require_setup()
        if not isinstance(payload, dict) or set(payload) != {'request_id', 'report_id', 'evidence'}:
            raise EventError('Supply the claim request reference, item and private evidence only.')
        event = self.events.get(identifier)
        profile = self.db.get_user_by_account_id(actor)
        if not profile or profile.get('verification_status') != 'verified':
            raise EventError('Verify your E-Balik account before claiming an item.', 403, 'verification_required')
        evidence = _text(payload['evidence'], 'Private ownership evidence', 2000, True)
        if len(evidence) < 20:
            raise EventError('Describe at least 20 characters of ownership evidence.')
        request_id, report_id = event_id(payload['request_id']), event_id(payload['report_id'])
        existing = self.events._execute(self.client.table('event_claims').select('*').eq('event_id', event['event_id']).eq('claimant_account_id', actor).eq('request_id', request_id).limit(1))
        if existing:
            return self.view(existing[0], owner=True)
        if not self.reports.open(event):
            raise EventError('Event claims are currently closed.', 409)
        report = self.reports._row(identifier, report_id)
        if report['kind'] != 'found' or report['moderation_status'] != 'approved' or report.get('withdrawn_at') or report.get('released_at') or report.get('reporter_account_id') == actor:
            raise EventError('This item cannot accept a claim from your account.', 409)
        claim_id, path = str(uuid4()), None
        if photo is not None:
            content = normalize_artwork(photo, 'banner')
            path = f'{event["event_id"]}/claims/{claim_id}/{uuid4().hex}.webp'
            self.client.storage.from_(BUCKET).upload(path, content, {'content-type': 'image/webp', 'upsert': 'false', 'cache-control': '0'})
        data = dict(request_id=request_id, report_id=report_id, evidence=evidence, proof_path=path)
        try:
            result = self.rpc('event_claim_command', dict(p_event_id=event['event_id'], p_actor_id=event_id(actor), p_claim_id=claim_id, p_action='create', p_version=None, p_data=data))
        except EventError:
            if path:
                self._cleanup(path)
            raise
        if path and result['claim'].get('proof_path') != path:
            self._cleanup(path)
        return self.view(result['claim'], owner=True)

    def _cleanup(self, path):
        try:
            used = self.events._execute(self.client.table('event_claims').select('claim_id').eq('proof_path', path).limit(1))
            if not used:
                self.client.storage.from_(BUCKET).remove([path])
        except Exception:
            pass  # Preserve an upload when its reference status is uncertain.

    def action(self, identifier, claim_id, payload, actor):
        if not isinstance(payload, dict) or set(payload) != {'action', 'version', 'data'} or payload['action'] not in ('approve', 'reject', 'withdraw', 'reset_pin', 'release') or not isinstance(payload['data'], dict):
            raise EventError('Choose an available event claim action.')
        self.reports._version(payload['version'])
        action, values = payload['action'], payload['data']
        owner = action in ('withdraw', 'reset_pin')
        row = self._claim(identifier, claim_id)
        if owner:
            if row.get('claimant_account_id') != actor or values:
                raise EventError('This ownership action belongs to the claimant only.', 403)
            data = {}
        else:
            workspace = self.lifecycle.authorize_workspace(identifier, actor)
            if action in ('approve', 'reject') and workspace['role'] != 'manager':
                raise EventError('Event manager access required.', 403)
            allowed = {'note', 'pin', 'identity_checked'} if action == 'release' else {'note'}
            if set(values) != allowed:
                raise EventError('Supply the fields for this claim action only.')
            note = _text(values['note'], 'Decision or release note', 1000, True)
            if len(note) < 5:
                raise EventError('Enter a reason of at least five characters.')
            data = {'note': note}
            if action == 'release':
                raw = values['pin']
                pin = raw.upper().replace(' ', '').replace('-', '') if isinstance(raw, str) else ''
                if len(pin) != PIN_LENGTH or any(char not in PIN_ALPHABET for char in pin) or values['identity_checked'] is not True:
                    raise EventError('Enter the six-character pickup code and confirm the in-person identity check.')
                data.update(pin_hash=self.pin_hash(claim_id, pin), identity_checked=True)
        if action in ('approve', 'reset_pin'):
            pin = generate_pin()
            data.update(pin_hash=self.pin_hash(claim_id, pin), pin_encrypted=CryptoService.encrypt(pin))
        result = self.rpc('event_claim_command', dict(p_event_id=event_id(identifier), p_actor_id=event_id(actor), p_claim_id=event_id(claim_id), p_action=action, p_version=payload['version'], p_data=data))
        return self.view(result['claim'], owner=owner)

    def proof(self, identifier, claim_id, actor):
        row = self._claim(identifier, claim_id)
        if row.get('claimant_account_id') != actor:
            self.lifecycle.authorize_workspace(identifier, actor)
        path = row.get('proof_path')
        if not path or not re.fullmatch(rf'{re.escape(event_id(identifier))}/claims/{re.escape(event_id(claim_id))}/[0-9a-f]{{32}}\.webp', path):
            raise EventError('Claim proof image not found.', 404)
        return self.client.storage.from_(BUCKET).download(path)

    @staticmethod
    def receipt_code(row):
        return hmac.new(CryptoService._get_key(), f'event-receipt:{row["claim_id"]}:{parse(row["released_at"]).isoformat()}'.encode(), hashlib.sha256).hexdigest()[:16].upper()

    def receipt(self, identifier, claim_id, actor):
        row = self._claim(identifier, claim_id)
        if row.get('claimant_account_id') != actor:
            self.lifecycle.authorize_workspace(identifier, actor)
        if row['status'] != 'released' or not row.get('released_at'):
            raise EventError('A release receipt is available only after verified handover.', 409)
        return {'receipt_no': 'EVR-' + row['claim_id'].replace('-', '').upper(), 'claim_id': row['claim_id'], 'event_id': row['event_id'], 'event_name': row['receipt_event_name'], 'item_label': row['receipt_item_label'], 'released_to': row['recipient_name'], 'released_at': row['released_at'], 'verification_code': self.receipt_code(row)}

    def verify_receipt(self, claim_id, code):
        self.require_setup()
        if not isinstance(code, str) or not re.fullmatch('[0-9A-Fa-f]{16}', code):
            raise EventError('Valid receipt verification code required.', 404)
        rows = self.events._execute(self.client.table('event_claims').select('*').eq('claim_id', event_id(claim_id)).eq('status', 'released').limit(1))
        if not rows or not hmac.compare_digest(self.receipt_code(rows[0]), code.upper()):
            raise EventError('Release receipt not found.', 404)
        return {'valid': True, 'item_label': rows[0]['receipt_item_label'], 'released_on': parse(rows[0]['released_at']).date().isoformat(), 'receipt_no': 'EVR-' + rows[0]['claim_id'].replace('-', '').upper()}
