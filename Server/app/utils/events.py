"""Draft event configuration only. No campus report, tag, or finance writes."""
import re
import unicodedata
from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4


class EventError(ValueError):
    def __init__(self, message, status=400, code='invalid_event'):
        super().__init__(message)
        self.status, self.code = status, code


class EventSetupRequired(EventError):
    def __init__(self):
        super().__init__('Event foundation migration is required.', 503, 'setup_required')


def event_id(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise EventError('Invalid event identifier.') from None


def _text(value, name, maximum, required=False):
    if not isinstance(value, str) or len(value.strip()) > maximum or any(ord(c) < 32 or c in '<>' for c in value):
        raise EventError(f'{name} must be plain text of at most {maximum} characters.')
    value = value.strip()
    if required and not value:
        raise EventError(f'{name} is required.')
    return value


def _date(value):
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError, AttributeError):
        raise EventError('Dates must be ISO timestamps with a timezone.') from None


DEFAULT_BRANDING = {'template': 'classic', 'primary': '#1f3160', 'accent': '#d1a153', 'background': '#ffffff'}
# Same options as Admin/Frontend/src/utils/itemOptions.ts; event UI reads this list.
CAMPUS_VENUES = ('Library', 'Gymnasium', 'Cafeteria', 'Admin Building', 'Oval Track', 'Engineering Building', 'Lost and Found Office')


def safe_person(profile):
    return {key: profile.get(key) for key in ('account_id', 'fname', 'lname', 'email', 'is_active')}


def branding(value):
    if not isinstance(value, dict) or set(value) - set(DEFAULT_BRANDING):
        raise EventError('Unsupported branding settings.')
    result = {**DEFAULT_BRANDING, **value}
    if not isinstance(result['template'], str) or result['template'] not in ('classic', 'festival', 'sports'):
        raise EventError('Unsupported event template.')
    for key in ('primary', 'accent', 'background'):
        if not isinstance(result[key], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', result[key]):
            raise EventError('Colors must be six-digit hex values.')
        result[key] = result[key].lower()
    return result


FIELDS = {'name', 'slug', 'organizer_name', 'venue', 'desk_instructions', 'starts_at', 'ends_at', 'recovery_ends_at', 'branding'}


def validate(payload, current=None):
    if not isinstance(payload, dict) or not payload or set(payload) - FIELDS:
        raise EventError('Supply supported event fields only.')
    current = current or {}
    result = {}
    for key, maximum in (('name', 120), ('organizer_name', 160), ('venue', 240), ('desk_instructions', 1000)):
        if key in payload:
            result[key] = _text(payload[key], key, maximum, key == 'name')
    if not current and 'name' not in result:
        raise EventError('name is required.')
    if 'venue' in result and result['venue'] and result['venue'] not in CAMPUS_VENUES:
        raise EventError('Choose a university venue from the current campus list.')
    if 'slug' in payload:
        slug = payload['slug']
        if not isinstance(slug, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug) or not 3 <= len(slug) <= 80:
            raise EventError('slug must be 3–80 lowercase letters/digits separated by hyphens.')
        result['slug'] = slug
    if not current and 'slug' not in result:
        plain = unicodedata.normalize('NFKD', result['name']).encode('ascii', 'ignore').decode('ascii').lower()
        base = re.sub(r'[^a-z0-9]+', '-', plain).strip('-')[:60].rstrip('-') or 'event'
        result['slug'] = f'{base}-{uuid4().hex[:8]}'
    for key in ('starts_at', 'ends_at', 'recovery_ends_at'):
        if key in payload:
            result[key] = _date(payload[key])
    combined = {**current, **result}
    dates = [combined.get(k) for k in ('starts_at', 'ends_at', 'recovery_ends_at')]
    if any(dates) and not all(dates):
        raise EventError('Supply all three dates, or leave all three empty.')
    if all(dates) and not datetime.fromisoformat(dates[0]) < datetime.fromisoformat(dates[1]) <= datetime.fromisoformat(dates[2]):
        raise EventError('Dates must satisfy start < end <= recovery deadline.')
    if 'branding' in payload:
        result['branding'] = branding(payload['branding'])
    return result


class EventFoundation:
    def __init__(self, db):
        self.db = db
        self.client = db.client

    @staticmethod
    def _execute(query, duplicate_message='That event slug is already in use.'):
        try:
            return query.execute().data or []
        except Exception as error:
            code = str(getattr(error, 'code', ''))
            if code in ('42P01', 'PGRST205'):
                raise EventSetupRequired() from error
            if code == '23505':
                raise EventError(duplicate_message, 409, 'duplicate_event') from error
            raise

    def list(self, offset=0):
        return self._execute(self.client.table('event_workspaces').select('*').order('created_at', desc=True).range(offset, offset + 49))

    def get(self, identifier, include_deleted=False):
        rows = self._execute(self.client.table('event_workspaces').select('*').eq('event_id', event_id(identifier)).limit(1))
        if not rows or (rows[0].get('deleted_at') and not include_deleted):
            raise EventError('Event not found.', 404, 'not_found')
        return rows[0]

    def memberships(self, identifier):
        row = self.get(identifier)
        rows = self._execute(self.client.table('event_memberships').select('*').eq('event_id', row['event_id']).order('created_at', desc=True).limit(500))
        if not rows:
            return rows
        profiles = self._execute(self.client.table('user_profiles').select('account_id,fname,lname,email,is_active').in_('account_id', [r['account_id'] for r in rows]))
        lookup = {str(p['account_id']): safe_person(p) for p in profiles}
        return [{**r, 'person': lookup.get(str(r['account_id']))} for r in rows]

    def staff_lookup(self, identifier, email):
        self.get(identifier)
        if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email.strip()):
            raise EventError('Enter the exact email of an existing account.')
        rows = self._execute(self.client.table('user_profiles').select('account_id,fname,lname,email,is_active').eq('email', email.strip().lower()).eq('is_active', True).limit(1))
        if not rows:
            raise EventError('No active account matches that email.', 404, 'not_found')
        return safe_person(rows[0])

    def assign(self, identifier, payload, actor_id):
        row = self.get(identifier)
        if row['status'] in ('closed', 'archived', 'cancelled'):
            raise EventError('Staff cannot be assigned to a closed, archived or cancelled event.', 409, 'event_locked')
        if not isinstance(payload, dict) or set(payload) != {'account_id', 'role', 'expires_at'}:
            raise EventError('Supply account_id, role and expires_at only.')
        account = event_id(payload['account_id'])
        if payload['role'] not in ('manager', 'desk_staff'):
            raise EventError('Choose manager or desk_staff.')
        expiry = _date(payload['expires_at'])
        now = datetime.now(timezone.utc)
        recovery = datetime.fromisoformat(row['recovery_ends_at']) if row.get('recovery_ends_at') else None
        deadline_label = recovery.astimezone(timezone(timedelta(hours=8))).strftime('%b %d, %Y at %I:%M %p (Manila time)') if recovery else None
        if recovery and recovery <= now:
            raise EventError(f'The final claiming deadline ({deadline_label}) has passed. Update the event Schedule before assigning staff.', 409, 'recovery_ended')
        if expiry is None or datetime.fromisoformat(expiry) <= now:
            raise EventError('Staff access must expire in the future.')
        if recovery and datetime.fromisoformat(expiry) > recovery:
            raise EventError(f'Staff access cannot end after {deadline_label}. Choose an earlier time or extend the final claiming date in Schedule.')
        profile = self.db.get_user_by_account_id(account)
        if not profile or profile.get('is_active') is not True:
            raise EventError('Choose an existing active account.')
        member = {'membership_id': str(uuid4()), 'event_id': row['event_id'], 'account_id': account,
                  'role': payload['role'], 'status': 'active', 'starts_at': now.isoformat(), 'expires_at': expiry,
                  'assigned_by': event_id(actor_id), 'created_at': now.isoformat(), 'updated_at': now.isoformat()}
        existing = self._execute(self.client.table('event_memberships').select('*').eq('event_id', row['event_id']).eq('account_id', account).limit(1))
        if existing:
            old = existing[0]
            if old['status'] == 'active' and datetime.fromisoformat(old['expires_at']) > now:
                raise EventError('This account already has active access. Revoke it before changing the assignment.', 409, 'member_conflict')
            changes = {key: member[key] for key in ('role', 'status', 'starts_at', 'expires_at', 'assigned_by', 'updated_at')}
            rows = self._execute(self.client.table('event_memberships').update(changes).eq('membership_id', old['membership_id']).eq('event_id', row['event_id']).eq('updated_at', old['updated_at']))
        else:
            rows = self._execute(self.client.table('event_memberships').insert(member), 'This account was assigned by another session. Refresh the team list.')
        if not rows:
            raise EventError('Staff assignment changed. Refresh the team list.', 409, 'member_conflict')
        return rows[0]

    def revoke(self, identifier, membership_id):
        row = self.get(identifier)
        rows = self._execute(self.client.table('event_memberships').update({'status': 'revoked', 'updated_at': datetime.now(timezone.utc).isoformat()})
                             .eq('event_id', row['event_id']).eq('membership_id', event_id(membership_id)))
        if not rows:
            raise EventError('Event membership not found.', 404, 'not_found')
        return rows[0]

    def create(self, payload, actor_id):
        row = {'event_id': str(uuid4()), 'status': 'draft', 'version': 1, 'branding': dict(DEFAULT_BRANDING),
               'created_by': event_id(actor_id), 'created_at': datetime.now(timezone.utc).isoformat(), **validate(payload)}
        rows = self._execute(self.client.table('event_workspaces').insert(row))
        if not rows:
            raise EventError('Event was not saved.', 503, 'save_failed')
        return rows[0]

    def update(self, identifier, payload, version):
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise EventError('A positive integer version is required.')
        current = self.get(identifier)
        if current['status'] != 'draft':
            raise EventError('Only draft events can be edited in this release.', 409, 'event_locked')
        if current['version'] != version:
            raise EventError('The event changed. Reload before saving.', 409, 'version_conflict')
        changes = {**validate(payload, current), 'version': version + 1, 'updated_at': datetime.now(timezone.utc).isoformat()}
        rows = self._execute(self.client.table('event_workspaces').update(changes).eq('event_id', current['event_id']).eq('version', version).eq('status', 'draft'))
        if not rows:
            raise EventError('The event changed. Reload before saving.', 409, 'version_conflict')
        return rows[0]
