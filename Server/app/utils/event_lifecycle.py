"""Private event readiness, explicit lifecycle and fresh membership authorization."""
from datetime import datetime, timezone
from app.utils.events import EventError, EventFoundation, CAMPUS_VENUES, event_id

MIGRATION = '20261116_event_lifecycle'
STATES = ('draft', 'scheduled', 'active', 'recovery', 'closed', 'archived', 'cancelled')


def parse(value):
    return datetime.fromisoformat(str(value).replace('Z', '+00:00')) if value else None


def usable_profile(profile, now):
    return bool(profile and profile.get('is_active') is True and not (parse(profile.get('suspended_until')) and parse(profile['suspended_until']) > now))


class EventLifecycle:
    def __init__(self, db):
        self.db = db
        self.events = EventFoundation(db)
        self.client = db.client

    def installed(self):
        return bool(self.events._execute(self.client.table('migration_log').select('name').eq('name', MIGRATION).limit(1)))

    def review(self, identifier, now=None):
        now = now or datetime.now(timezone.utc)
        row = self.events.get(identifier)
        dates = [parse(row.get(key)) for key in ('starts_at', 'ends_at', 'recovery_ends_at')]
        dates_ok = bool(all(dates) and dates[0] < dates[1] <= dates[2] and dates[1] > now)
        members = self.events._execute(self.client.table('event_memberships').select('account_id,starts_at,expires_at').eq('event_id', row['event_id']).eq('role', 'manager').eq('status', 'active').limit(500))
        managers = [m for m in members if parse(m.get('starts_at')) and parse(m.get('expires_at')) and parse(m['starts_at']) <= now < parse(m['expires_at']) and (not dates[2] or parse(m['expires_at']) >= dates[2])]
        profiles = self.events._execute(self.client.table('user_profiles').select('account_id,is_active,suspended_until').in_('account_id', [m['account_id'] for m in managers])) if managers else []
        manager_ok = any(usable_profile(p, now) for p in profiles)
        checks = [
            {'id': 'identity', 'label': 'Event name and organizer', 'ok': bool(row.get('name', '').strip() and row.get('organizer_name', '').strip()), 'step': 'details'},
            {'id': 'venue', 'label': 'University venue selected', 'ok': row.get('venue') in CAMPUS_VENUES, 'step': 'details'},
            {'id': 'desk', 'label': 'Collection desk instructions', 'ok': bool(row.get('desk_instructions', '').strip()), 'step': 'details'},
            {'id': 'dates', 'label': 'Complete schedule with time remaining before the event ends', 'ok': dates_ok, 'step': 'schedule'},
            {'id': 'manager', 'label': 'Active event manager assigned through the final claiming date', 'ok': manager_ok, 'step': 'team'},
        ]
        ready = all(c['ok'] for c in checks)
        status = row['status']
        actions = []
        if ready and status == 'draft' and dates[0] > now:
            actions.append('scheduled')
        if ready and status in ('draft', 'scheduled') and dates[0] <= now < dates[1]:
            actions.append('active')
        if status == 'scheduled' and dates[0] and now < dates[0]:
            actions.append('draft')
        if status == 'active' and dates[1] and now >= dates[1]:
            actions.append('recovery')
        if status == 'recovery' and dates[2] and now >= dates[2]:
            actions.append('closed')
        if status == 'closed':
            actions.append('archived')
        if status in ('draft', 'scheduled', 'active', 'recovery'):
            actions.append('cancelled')
        installed = self.installed()
        history = self.events._execute(self.client.table('event_state_history').select('history_id,from_status,to_status,note,created_at').eq('event_id', row['event_id']).order('created_at', desc=True).limit(100)) if installed else []
        return {'event': row, 'ready': ready, 'checks': checks, 'actions': actions if installed else [], 'lifecycle_available': installed, 'history': history, 'public_reporting_enabled': False}

    def transition(self, identifier, payload, actor_id):
        if not isinstance(payload, dict) or set(payload) != {'status', 'version', 'note'}:
            raise EventError('Supply status, version and a transition note.')
        if payload['status'] not in STATES or isinstance(payload['version'], bool) or not isinstance(payload['version'], int) or payload['version'] < 1:
            raise EventError('Supply a valid target state and current event version.')
        note = payload['note']
        if not isinstance(note, str) or not 5 <= len(note.strip()) <= 1000 or any(ord(c) < 32 or c in '<>' for c in note):
            raise EventError('Enter a plain-text reason of 5–1000 characters.')
        if not self.installed():
            raise EventError('Run 20261116_event_lifecycle.sql to enable lifecycle controls.', 503, 'lifecycle_setup_required')
        self.events.get(identifier)  # Deleted events must be restored before any legacy lifecycle RPC.
        try:
            result = self.client.rpc('event_transition', {'p_event_id': event_id(identifier), 'p_actor_id': event_id(actor_id), 'p_version': payload['version'], 'p_target': payload['status'], 'p_note': note.strip()}).execute().data
        except Exception as error:
            if str(getattr(error, 'code', '')) in ('42883', 'PGRST202'):
                raise EventError('Event lifecycle function is unavailable. Verify the lifecycle migration.', 503, 'lifecycle_setup_required') from error
            raise
        if not isinstance(result, dict) or not result.get('ok'):
            raise EventError(result.get('error', 'Unable to transition this event.') if isinstance(result, dict) else 'Invalid lifecycle response.', 409, 'transition_refused')
        return result['event']

    def authorize_workspace(self, identifier, account_id, now=None):
        now = now or datetime.now(timezone.utc)
        account_id = event_id(account_id)
        profile = self.db.get_user_by_account_id(account_id)
        if not usable_profile(profile, now):
            raise EventError('Active account access required.', 403, 'event_access_denied')
        # Read membership on every request; no JWT role claim or cached assignment grants access.
        members = self.events._execute(self.client.table('event_memberships').select('role,starts_at,expires_at').eq('event_id', event_id(identifier)).eq('account_id', account_id).eq('status', 'active').limit(1))
        if not members or members[0]['role'] not in ('manager', 'desk_staff') or not (parse(members[0]['starts_at']) <= now < parse(members[0]['expires_at'])):
            raise EventError('This event workspace is not assigned to you, or access has expired.', 403, 'event_access_denied')
        row = self.events.get(identifier)
        if row['status'] not in ('scheduled', 'active', 'recovery') or not parse(row.get('recovery_ends_at')) or now >= parse(row['recovery_ends_at']):
            raise EventError('This event workspace is not open to staff.', 403, 'event_access_denied')
        fields = ('event_id', 'name', 'organizer_name', 'venue', 'desk_instructions', 'starts_at', 'ends_at', 'recovery_ends_at', 'status')
        return {'event': {key: row.get(key) for key in fields}, 'role': members[0]['role'], 'expires_at': members[0]['expires_at'], 'permissions': ['view_workspace'], 'reporting_enabled': False}
