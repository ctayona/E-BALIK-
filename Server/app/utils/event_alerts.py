"""Private, manager-reviewed event notices; no campus notifications or email hooks."""
from datetime import datetime, timezone
from app.utils.events import EventError, event_id
from app.utils.event_lifecycle import usable_profile
from app.utils.event_matching import pair_details
from app.utils.event_reports import EventReports, BOARD_FIELDS

MIGRATION = '20261117_event_match_alerts'
TITLE = 'A possible match for your event report'
MESSAGE = 'An event manager flagged a possible match for your missing report. Review the approved event listing and submit ownership evidence if it could be yours.'
ALERT_FIELDS = 'alert_id,event_id,missing_report_id,found_report_id,recipient_account_id,status,inactive_reason,read_at,dismissed_at,created_at'


class EventAlerts:
    def __init__(self, db):
        self.db, self.client = db, db.client
        self.reports = EventReports(db)
        self.events = self.reports.events

    def installed(self):
        return self.reports.alerts_installed()

    def require_setup(self):
        if not self.installed():
            raise EventError('Event alerts are not enabled yet.', 503, 'event_alerts_setup_required')

    def recipient(self, actor):
        profile = self.db.get_user_by_account_id(actor) if actor else None
        if not usable_profile(profile, datetime.now(timezone.utc)) or profile.get('verification_status') != 'verified':
            raise EventError('An active verified account is required for event alerts.', 403, 'verification_required')

    def _rpc(self, name, params):
        self.require_setup()
        try:
            result = self.client.rpc(name, params).execute().data
        except Exception as error:
            if str(getattr(error, 'code', '')) in ('42883', 'PGRST202'):
                raise EventError('Event alert setup is incomplete.', 503, 'event_alerts_setup_required') from error
            raise
        if not isinstance(result, dict) or not result.get('ok'):
            raise EventError(result.get('error', 'Event alert action refused.') if isinstance(result, dict) else 'Invalid alert response.', 409, 'event_alert_conflict')
        return result

    def _pair(self, identifier, missing_id, payload, actor):
        self.require_setup()
        workspace = self.reports.lifecycle.authorize_workspace(identifier, actor)
        if workspace['role'] != 'manager':
            raise EventError('Only an assigned event manager can notify report owners.', 403)
        if not isinstance(payload, dict) or set(payload) != {'found_report_id', 'missing_version', 'found_version'}:
            raise EventError('Supply the found report and both reviewed report versions only.')
        for field in ('missing_version', 'found_version'):
            self.reports._version(payload[field])
        event = self.events.get(identifier)
        if not self.reports.open(event):
            raise EventError('Open the event attendee page before sending match alerts.', 409)
        missing = self.reports._row(identifier, missing_id)
        found = self.reports._row(identifier, payload['found_report_id'])
        if missing['version'] != payload['missing_version'] or found['version'] != payload['found_version']:
            raise EventError('A report changed. Refresh and review the suggestion again.', 409)
        if found.get('moderation_status') != 'approved' or not pair_details(missing, found):
            raise EventError('Review a qualifying missing report and an approved, available found listing first.', 409)
        owner = missing.get('reporter_account_id')
        self.recipient(owner)
        old = self.events._execute(self.client.table('event_match_alerts').select('alert_id,status').eq('event_id', event['event_id']).eq('missing_report_id', missing['report_id']).eq('found_report_id', found['report_id']).limit(1))
        if not old and self._claim_status(event['event_id'], found['report_id'], owner):
            raise EventError('The report owner already has an ownership request for this listing.', 409)
        return event, missing, found, old

    @staticmethod
    def listing(found):
        return {**{key: found.get(key) for key in BOARD_FIELDS}, 'reference': 'EV-' + found['report_id'][:8].upper()}

    def preview(self, identifier, missing_id, payload, actor):
        event, missing, found, old = self._pair(identifier, missing_id, payload, actor)
        return {'event_name': event['name'], 'title': TITLE, 'message': MESSAGE, 'missing_reference': 'EV-' + missing['report_id'][:8].upper(),
                'listing': self.listing(found), 'missing_report_id': missing['report_id'], 'found_report_id': found['report_id'],
                'missing_version': missing['version'], 'found_version': found['version'], 'already_sent': bool(old)}

    def send(self, identifier, missing_id, payload, actor):
        event, missing, found, old = self._pair(identifier, missing_id, payload, actor)
        result = self._rpc('event_send_match_alert', dict(p_event_id=event['event_id'], p_actor_id=event_id(actor), p_missing_id=missing['report_id'], p_found_id=found['report_id'], p_missing_version=payload['missing_version'], p_found_version=payload['found_version']))
        return {'sent': True, 'already_sent': bool(result.get('replayed')), 'alert_id': result['alert']['alert_id']}

    def _claim_status(self, identifier, found_id, actor):
        if not actor:
            return None
        rows = self.events._execute(self.client.table('event_claims').select('status').eq('event_id', identifier).eq('report_id', found_id).eq('claimant_account_id', actor).in_('status', ['pending', 'approved', 'released']).limit(1))
        return rows[0]['status'] if rows else None

    def render(self, row, event, reports, actor, claim_status=None):
        missing, found = reports.get(row['missing_report_id']), reports.get(row['found_report_id'])
        owns = bool(missing and missing.get('reporter_account_id') == actor)
        valid = bool(owns and found and row['status'] == 'active' and self.reports.open(event)
                     and missing.get('kind') == 'missing' and missing.get('moderation_status') in ('pending', 'approved') and not missing.get('withdrawn_at') and not missing.get('released_at')
                     and found.get('kind') == 'found' and found.get('board_consent') is True and found.get('moderation_status') == 'approved' and not found.get('withdrawn_at') and not found.get('released_at'))
        fields = ('alert_id', 'event_id', 'read_at', 'dismissed_at', 'created_at')
        return {**{key: row.get(key) for key in fields}, 'title': TITLE, 'message': MESSAGE, 'status': 'active' if valid else 'inactive',
                'missing_label': missing.get('item_name') if owns else 'Your event report', 'missing_reference': 'EV-' + row['missing_report_id'][:8].upper(),
                'listing': self.listing(found) if valid else None, 'claim_status': claim_status if valid else None,
                'can_claim': valid and not claim_status,
                'availability_note': '' if valid else 'This event or linked report is no longer available for this alert.'}

    def _rows_for_alerts(self, identifier, alerts):
        identifiers = list({row[key] for row in alerts for key in ('missing_report_id', 'found_report_id')})
        if not identifiers:
            return {}
        rows = self.events._execute(self.client.table('event_reports').select(self.reports.columns()).eq('event_id', identifier).in_('report_id', identifiers))
        return {row['report_id']: row for row in rows}

    def mine(self, slug, actor, offset=0, view='inbox'):
        self.require_setup(); self.recipient(actor)
        if isinstance(offset, bool) or not isinstance(offset, int) or not 0 <= offset <= 100000:
            raise EventError('Invalid event alert page.')
        if view not in ('inbox', 'all'):
            raise EventError('Choose Inbox or All alerts.')
        event = self.reports.event_for_slug(slug, include_deleted=True)
        query = self.client.table('event_match_alerts').select(ALERT_FIELDS).eq('event_id', event['event_id']).eq('recipient_account_id', actor)
        if view == 'inbox':
            query = query.is_('dismissed_at', 'null')
        rows = self.events._execute(query.order('created_at', desc=True).order('alert_id').range(offset, offset + 23))
        reports = self._rows_for_alerts(event['event_id'], rows)
        found_ids = list({row['found_report_id'] for row in rows})
        claims = self.events._execute(self.client.table('event_claims').select('report_id,status').eq('event_id', event['event_id']).eq('claimant_account_id', actor).in_('report_id', found_ids).in_('status', ['pending','approved','released']).limit(100)) if found_ids else []
        states = {row['report_id']: row['status'] for row in claims}
        return [self.render(row, event, reports, actor, states.get(row['found_report_id'])) for row in rows]

    def count(self, slug, actor):
        if not self.installed():
            return {'available': False, 'unread_count': 0}
        self.recipient(actor)
        event = self.reports.event_for_slug(slug, include_deleted=True)
        count = self.client.rpc('event_alert_unread_count', dict(p_event_id=event['event_id'], p_actor_id=event_id(actor))).execute().data
        return {'available': True, 'unread_count': max(0, int(count))}

    def action(self, identifier, alert_id, payload, actor):
        if not isinstance(payload, dict) or set(payload) != {'action'} or payload['action'] not in ('read', 'dismiss'):
            raise EventError('Choose read or dismiss only.')
        self.recipient(actor)
        result = self._rpc('event_alert_action', dict(p_event_id=event_id(identifier), p_alert_id=event_id(alert_id), p_actor_id=event_id(actor), p_action=payload['action']))
        row = result['alert']
        event = self.events.get(identifier, include_deleted=True)
        return self.render(row, event, self._rows_for_alerts(event['event_id'], [row]), actor, self._claim_status(event['event_id'], row['found_report_id'], actor))
