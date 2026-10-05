"""Anti-spam rules for lost and found reports: an active-report limit and a similar-report check."""
import re
import threading
from contextlib import contextmanager
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional

MAX_ACTIVE_REPORTS = 6
MIN_DESCRIPTION_CHARS = 12

# A report stops counting toward the limit once it is resolved or handed over.
ACTIVE_MISSING_STATUSES = {'', 'missing', 'active', 'open', 'pending'}
ACTIVE_FOUND_STATUSES = {'', 'unclaimed', 'review', 'pending', 'active'}


class ReportRuleError(Exception):
    """A report was refused by an anti-spam rule. `code` is stable for the frontend, `status` is the HTTP status."""

    def __init__(self, code: str, message: str, status: int, **extra: Any):
        super().__init__(message)
        self.code, self.message, self.status, self.extra = code, message, status, extra


def _status(row: Dict[str, Any]) -> str:
    return str(row.get('status') or '').strip().lower()


def is_active(row: Dict[str, Any], kind: str) -> bool:
    return _status(row) in (ACTIVE_MISSING_STATUSES if kind == 'missing' else ACTIVE_FOUND_STATUSES)


def _normal(text: Any) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]+', ' ', str(text or '').lower())).strip()


def _tokens(text: str) -> set:
    return {t for t in text.split(' ') if len(t) > 2}


def similarity(a: Any, b: Any) -> float:
    """0..1 text similarity: the better of character-sequence similarity and word overlap."""
    first, second = _normal(a), _normal(b)
    if not first or not second:
        return 0.0
    ratio = SequenceMatcher(None, first, second).ratio()
    ta, tb = _tokens(first), _tokens(second)
    overlap = len(ta & tb) / len(ta | tb) if ta and tb else 0.0
    return max(ratio, overlap)


def is_similar(candidate: Dict[str, Any], existing: Dict[str, Any]) -> bool:
    """Same item described again. The description must match strongly; a matching title makes that bar lower."""
    desc_a, desc_b = candidate.get('description'), existing.get('description')
    name = similarity(candidate.get('item_name'), existing.get('item_name'))
    desc = similarity(desc_a, desc_b)
    long_enough = len(_normal(desc_a)) >= MIN_DESCRIPTION_CHARS and len(_normal(desc_b)) >= MIN_DESCRIPTION_CHARS
    if long_enough and desc >= 0.9:
        return True
    return long_enough and name >= 0.85 and desc >= 0.7


def check_new_report(candidate: Dict[str, Any], kind: str, missing_rows: Iterable[Dict[str, Any]], found_rows: Iterable[Dict[str, Any]]) -> None:
    """Raise ReportRuleError when the account is at its limit or the report repeats one it already has."""
    missing_active = [r for r in missing_rows if is_active(r, 'missing')]
    found_active = [r for r in found_rows if is_active(r, 'found')]
    if len(missing_active) + len(found_active) >= MAX_ACTIVE_REPORTS:
        raise ReportRuleError(
            'report_limit',
            f'You already have {MAX_ACTIVE_REPORTS} active reports, which is the limit. Resolve or delete one in My Reports before submitting another.',
            429, limit=MAX_ACTIVE_REPORTS,
        )
    same_kind: List[Dict[str, Any]] = missing_active if kind == 'missing' else found_active
    for row in same_kind:
        if is_similar(candidate, row):
            reference = row.get('mpost_id') or row.get('fpost_id') or ''
            raise ReportRuleError(
                'duplicate_report',
                f'This looks like a report you already submitted{f" ({reference})" if reference else ""}. Open My Reports to update it instead of creating another.',
                409, reference=reference,
            )


# ---------------------------------------------------------------------------------------------- double submits

_in_flight: set = set()
_in_flight_lock = threading.Lock()


def begin_submission(key: str) -> str:
    """Claim the slot for `key`. Raises ReportRuleError if the same submission is already running; pair with end_submission."""
    with _in_flight_lock:
        if key in _in_flight:
            raise ReportRuleError('duplicate_submission', 'This submission is already being processed. Please wait a moment.', 409)
        _in_flight.add(key)
    return key


def end_submission(key: Optional[str]) -> None:
    if key:
        with _in_flight_lock:
            _in_flight.discard(key)


@contextmanager
def submission_slot(key: str):
    begin_submission(key)
    try:
        yield
    finally:
        end_submission(key)
