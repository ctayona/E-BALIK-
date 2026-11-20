"""Read-only staff suggestions over event reports; never invokes campus jobs/alerts."""
from datetime import timedelta, timezone
from app.utils.events import EventError, event_id
from app.utils.event_reports import EventReports
from app.utils.event_lifecycle import parse
from app.utils.matching import match_details

SCAN_LIMIT, RESULT_LIMIT, MIN_SCORE, MIN_TEXT = 100, 12, 60, 30
CARD_FIELDS = ('report_id', 'event_id', 'kind', 'item_name', 'category', 'venue', 'occurred_at', 'moderation_status', 'received_at', 'released_at', 'version')


def eligible(row):
    return (row.get('kind') in ('missing', 'found') and row.get('moderation_status') in ('pending', 'approved')
            and not row.get('withdrawn_at') and not row.get('released_at'))


def card(row):
    return {**{key: row.get(key) for key in CARD_FIELDS}, 'reference': 'EV-' + row['report_id'][:8].upper()}


def adapted(row):
    # The shared scorer receives text/category/venue/date only. Private media is not fetched.
    value = {key: row.get(key) for key in ('item_name', 'category', 'description')}
    date = parse(row.get('occurred_at'))
    local_date = date.astimezone(timezone(timedelta(hours=8))).date().isoformat() if date else None
    if row['kind'] == 'missing':
        value.update(last_location=row.get('venue'), last_seen_date=local_date)
    else:
        value.update(location=row.get('venue'), found_date=local_date)
    return value


def pair_details(missing, found):
    """Pure eligibility/scoring shared with manager alert review; no notification side effects."""
    if (not eligible(missing) or not eligible(found) or missing['kind'] != 'missing' or found['kind'] != 'found'
            or missing.get('event_id') != found.get('event_id')
            or (missing.get('reporter_account_id') and missing['reporter_account_id'] == found.get('reporter_account_id'))
            or (missing['category'] != found['category'] and 'Others' not in (missing['category'], found['category']))):
        return None
    lost_at, found_at = parse(missing.get('occurred_at')), parse(found.get('occurred_at'))
    if not lost_at or not found_at or found_at < lost_at:
        return None
    result = match_details(adapted(missing), adapted(found))
    text = result['components'].get('text')
    return result if result['score'] >= MIN_SCORE and text and text['percent'] >= MIN_TEXT else None


class EventMatching:
    def __init__(self, db):
        self.reports = EventReports(db)
        self.events, self.client = self.reports.events, db.client

    def suggestions(self, identifier, report_id, actor, offset=0):
        self.reports.require_setup()
        self.reports.lifecycle.authorize_workspace(identifier, actor)
        identifier, report_id = event_id(identifier), event_id(report_id)
        source = self.reports._row(identifier, report_id)
        if not eligible(source):
            raise EventError('Choose a pending or approved report that has not been withdrawn or released.', 409, 'event_match_source_unavailable')
        if type(offset) is not int or offset < 0 or offset > 100000:
            raise EventError('Invalid matching page.')
        query = (self.client.table('event_reports').select(self.reports.columns()).eq('event_id', identifier)
                 .eq('kind', 'found' if source['kind'] == 'missing' else 'missing')
                 .in_('moderation_status', ['pending', 'approved']).is_('withdrawn_at', 'null'))
        if self.reports.recovery_installed():
            query = query.is_('released_at', 'null')
        if source['category'] != 'Others':
            query = query.in_('category', [source['category'], 'Others'])
        rows = self.events._execute(query.order('created_at', desc=True).order('report_id').range(offset, offset + SCAN_LIMIT))
        matches, compared = [], 0
        for candidate in rows[:SCAN_LIMIT]:
            # Defense in depth against accidental future scope/filter changes.
            if candidate.get('event_id') != identifier or not eligible(candidate) or candidate['kind'] == source['kind']:
                continue
            if source.get('reporter_account_id') and source['reporter_account_id'] == candidate.get('reporter_account_id'):
                continue
            missing, found = (source, candidate) if source['kind'] == 'missing' else (candidate, source)
            lost_at, found_at = parse(missing.get('occurred_at')), parse(found.get('occurred_at'))
            if not lost_at or not found_at or found_at < lost_at:
                continue
            compared += 1
            result = pair_details(missing, found)
            if not result:
                continue
            matches.append({'report': card(candidate), 'score': result['score'], 'components': result['components'],
                            'reasons': result['reasons'][:6], 'conflicts': result['conflicts'][:6]})
        matches.sort(key=lambda value: (-value['score'], not bool((source if source['kind'] == 'found' else value['report']).get('received_at')), value['report']['report_id']))
        shortlist = matches[:RESULT_LIMIT]
        alerts_available = self.reports.alerts_installed()
        if alerts_available and shortlist:
            source_key, other_key = ('missing_report_id', 'found_report_id') if source['kind'] == 'missing' else ('found_report_id', 'missing_report_id')
            alerts = self.events._execute(self.client.table('event_match_alerts').select('missing_report_id,found_report_id,status').eq('event_id', identifier).eq(source_key, report_id).in_(other_key, [value['report']['report_id'] for value in shortlist]))
            sent = {row[other_key]: row['status'] for row in alerts}
            for value in shortlist:
                value['alert_status'] = sent.get(value['report']['report_id'])
        return {'source': card(source), 'matches': shortlist, 'alerts_available': alerts_available, 'offset': offset,
                'scanned': min(len(rows), SCAN_LIMIT), 'compared': compared, 'has_more': len(rows) > SCAN_LIMIT,
                'scan_limit': SCAN_LIMIT, 'result_limit': RESULT_LIMIT, 'minimum_score': MIN_SCORE}
