import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.utils.claim_status import normalize_claim_status, validate_claim_status_transition


def test_normalize_safe_legacy_approved_status():
    assert normalize_claim_status('approved') == 'approved_for_pickup'
    assert normalize_claim_status('verified') == 'approved_for_pickup'
    assert normalize_claim_status('accepted') == 'approved_for_pickup'


def test_legacy_approved_claim_can_still_be_collected():
    assert validate_claim_status_transition('approved', 'collected') == 'collected'
    assert validate_claim_status_transition('verified', 'collected') == 'collected'


def test_pending_claims_still_require_approval_or_rejection():
    try:
        validate_claim_status_transition('pending', 'collected')
        raise AssertionError('Expected pending claim transition to be rejected')
    except ValueError as exc:
        assert 'only be approved for pickup or rejected' in str(exc)
