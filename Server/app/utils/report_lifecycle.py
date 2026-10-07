"""Keep reports in step with what happened to the item in custody.

An item goes: report -> custody -> claim or auction -> release. When it is released, every report that was about it is finished:
  * the found report becomes `returned` (done by the claim status database function);
  * the claimant's own lost report becomes `returned` (shown to people as "Completed");
  * the person who turned the item in is told it reached its owner.

The database trigger `close_reports_after_claim_collection` closes the lost report that the claimant named on the claim and any report an
administrator confirmed as a match. This module covers the rest and works without the trigger:
  1. the named or confirmed report, if the trigger has not (older database, or a path that bypasses it);
  2. otherwise the claimant's single best open lost report that scores as a strong match (75%+) for the item, because the person who just
     collected the item is the person who lost it and forgetting to link the report must not leave it "missing" forever.
Everything is idempotent (it only touches reports that are still open) and a failure here never undoes a release.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.utils.matching import match_percentage

logger = logging.getLogger(__name__)

OPEN_MISSING = ('missing', 'found', 'open')
COMPLETED_MISSING = frozenset({'returned', 'resolved', 'closed'})
COMPLETED_FOUND = frozenset({'returned', 'claimed', 'closed', 'collected'})
STRONG_MATCH = 75
MISSING_COLUMNS = 'item_id,mpost_id,account_id,reporter_account_id,item_name,category,description,distinctive_marks,last_location,last_seen_date,status'
FOUND_COLUMNS = 'item_id,fpost_id,account_id,reporter_account_id,item_name,category,description,location,found_date,status'


def is_completed(kind: str, status: Any) -> bool:
    """Whether a report in this status is finished. `kind` is 'missing' or 'found'."""
    value = str(status or '').strip().lower()
    return value in (COMPLETED_MISSING if kind == 'missing' else COMPLETED_FOUND)


def _owner(row: Dict[str, Any]) -> Optional[str]:
    return row.get('reporter_account_id') or row.get('account_id')


class ReportLifecycle:
    def __init__(self, db):
        self.db = db
        self.client = db.client

    # ------------------------------------------------------------------------------------------------ claim collected
    def complete_for_claim(self, claim_id: str, notify_finder: bool = True) -> Dict[str, Any]:
        """Finish the reports around a collected claim. Returns what changed; never raises."""
        result: Dict[str, Any] = {'missing_closed': [], 'finder_notified': False}
        try:
            claim = self._claim(claim_id)
            if not claim or str(claim.get('status') or '').lower() != 'collected':
                return result
            found = self._first('found_items', FOUND_COLUMNS, 'item_id', claim.get('found_item_id'))
            if not found:
                return result
            claimant = claim.get('claimant_account_id')
            result['missing_closed'] = self._close_claimant_reports(claim, found)
            if notify_finder:
                result['finder_notified'] = self._notify_finder(found, claimant)
        except Exception as error:
            logger.warning('Report sync after claim %s failed: %s', claim_id, error)
        return result

    def _claim(self, claim_id: str) -> Optional[Dict[str, Any]]:
        columns = 'claim_id,found_item_id,claimant_account_id,status,missing_report_id'
        try:
            return self._first('claims', columns, 'claim_id', claim_id)
        except Exception:
            # The column arrives with migration 20261015; until then only confirmed matches and strong matches can close a report.
            return self._first('claims', 'claim_id,found_item_id,claimant_account_id,status', 'claim_id', claim_id)

    def _first(self, table: str, columns: str, key: str, value: Any) -> Optional[Dict[str, Any]]:
        if not value:
            return None
        rows = self.client.table(table).select(columns).eq(key, value).limit(1).execute().data or []
        return rows[0] if rows else None

    def _reports_of(self, account_id: Any) -> List[Dict[str, Any]]:
        by_reporter = self.client.table('missing_items').select(MISSING_COLUMNS).eq('reporter_account_id', account_id).limit(500).execute().data or []
        by_account = self.client.table('missing_items').select(MISSING_COLUMNS).eq('account_id', account_id).limit(500).execute().data or []
        merged: Dict[str, Dict[str, Any]] = {}
        for row in by_reporter + by_account:
            merged[str(row['item_id'])] = row
        return list(merged.values())

    def _confirmed_report_ids(self, found_item_id: Any) -> set:
        try:
            rows = self.client.table('ai_matches').select('missing_item_id').eq('found_item_id', found_item_id).eq('status', 'confirmed').limit(500).execute().data or []
        except Exception:
            return set()
        return {str(row.get('missing_item_id')) for row in rows}

    def _close_claimant_reports(self, claim: Dict[str, Any], found: Dict[str, Any]) -> List[str]:
        claimant = claim.get('claimant_account_id')
        reports = self._reports_of(claimant)
        named = {str(claim['missing_report_id'])} if claim.get('missing_report_id') else set()
        linked = named | self._confirmed_report_ids(found['item_id'])
        closed: List[str] = []

        chosen = [r for r in reports if str(r['item_id']) in linked and str(r.get('status') or '').lower() in OPEN_MISSING]
        if not chosen and not any(str(r['item_id']) in linked for r in reports):
            # Nothing was linked by the claimant or an administrator, so fall back to the one clear match. A report that is already
            # completed and matches this item as strongly means the fallback has run before: stop, so a rerun never closes a second report.
            best, best_score, already_done = None, 0.0, False
            for report in reports:
                score = match_percentage(report, found)
                if score < STRONG_MATCH:
                    continue
                status = str(report.get('status') or '').lower()
                if status in COMPLETED_MISSING:
                    already_done = True
                elif status in OPEN_MISSING and score > best_score:
                    best, best_score = report, score
            chosen = [best] if best and not already_done else []

        for report in chosen:
            if self._close(report, found):
                closed.append(str(report.get('mpost_id') or report['item_id']))
        return closed

    def _close(self, report: Dict[str, Any], found: Dict[str, Any]) -> bool:
        updated = self.client.table('missing_items').update({'status': 'returned', 'updated_at': _now_iso()}) \
            .eq('item_id', report['item_id']).in_('status', list(OPEN_MISSING)).execute().data or []
        if not updated:
            return False
        self._notify(
            _owner(report), 'Your lost report is completed',
            f'Your lost report "{report.get("item_name") or "your item"}" ({report.get("mpost_id") or "report"}) is now completed because the item was released to you.',
            'report_completed', found.get('item_id'), report.get('item_id'), 'View completed reports',
        )
        return True

    def _notify_finder(self, found: Dict[str, Any], claimant: Any) -> bool:
        finder = _owner(found)
        if not finder or str(finder) == str(claimant):
            return False
        return self._notify(
            finder, 'The item you turned in reached its owner',
            f'Thank you. "{found.get("item_name") or "The item"}" ({found.get("fpost_id") or "found report"}) was released to its owner, so your found report is now completed.',
            'report_completed', found.get('item_id'), None, 'View completed reports',
        )

    def _notify(self, account_id: Any, title: str, message: str, kind: str, found_item_id: Any, missing_report_id: Any, label: str) -> bool:
        if not account_id:
            return False
        try:
            self.db.create_user_notification(
                str(account_id), title, message, found_item_id=found_item_id, missing_report_id=missing_report_id,
                notification_type=kind, link_label=label, link_page='my-reports',
            )
            return True
        except Exception as error:
            logger.warning('Notification "%s" failed: %s', title, error)
            return False

    # ------------------------------------------------------------------------------------------------ an administrator set the item to returned
    def complete_for_found_item(self, found_item_id: Any) -> List[str]:
        """The item was marked returned by hand: close the lost reports an administrator confirmed as its match."""
        closed: List[str] = []
        try:
            found = self._first('found_items', FOUND_COLUMNS, 'item_id', found_item_id)
            confirmed = self._confirmed_report_ids(found_item_id)
            if not found or not confirmed:
                return closed
            rows = self.client.table('missing_items').select(MISSING_COLUMNS).in_('item_id', list(confirmed)).execute().data or []
            for report in rows:
                if str(report.get('status') or '').lower() in OPEN_MISSING and self._close(report, found):
                    closed.append(str(report.get('mpost_id') or report['item_id']))
        except Exception as error:
            logger.warning('Report sync for found item %s failed: %s', found_item_id, error)
        return closed

    # ------------------------------------------------------------------------------------------------ an auction winner collected the item
    def complete_for_auction(self, found_item_id: Any) -> bool:
        """The winner collected the item: the found report is finished and the finder is told it was sold. Never raises."""
        try:
            updated = self.client.table('found_items').update({'status': 'returned', 'updated_at': _now_iso()})                 .eq('item_id', found_item_id).eq('status', 'auctioned').execute().data or []
            if not updated:
                return False
            found = self._first('found_items', FOUND_COLUMNS, 'item_id', found_item_id) or updated[0]
            finder = _owner(found)
            if finder:
                self._notify(
                    finder, 'The item you turned in was sold',
                    f'"{found.get("item_name") or "The item"}" ({found.get("fpost_id") or "found report"}) was sold at auction and collected, so your found report is now completed.',
                    'report_completed', found.get('item_id'), None, 'View completed reports',
                )
            return True
        except Exception as error:
            logger.warning('Report sync for auctioned item %s failed: %s', found_item_id, error)
            return False

    # ------------------------------------------------------------------------------------------------ safety net for the scheduled run
    def reconcile(self, days: int = 60, now: Optional[datetime] = None) -> Dict[str, int]:
        """Re-check recently collected claims so a report missed for any reason (for example before this feature existed) is closed.

        Finder notices are not repeated here: they were sent when the claim was collected.
        """
        summary = {'checked': 0, 'closed': 0, 'errors': 0}
        since = ((now or datetime.now(timezone.utc)) - timedelta(days=days)).isoformat()
        try:
            claims = self.client.table('claims').select('claim_id').eq('status', 'collected').gte('collected_at', since).limit(500).execute().data or []
        except Exception as error:
            logger.warning('Report reconcile skipped: %s', error)
            summary['errors'] += 1
            return summary
        for row in claims:
            summary['checked'] += 1
            outcome = self.complete_for_claim(row['claim_id'], notify_finder=False)
            summary['closed'] += len(outcome.get('missing_closed') or [])
        return summary


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
