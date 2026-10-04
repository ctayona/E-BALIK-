"""Canonical claim status helpers used across the backend and SQL migrations."""

LEGACY_CLAIM_STATUS_MAP = {
    'approved': 'approved_for_pickup',
    'approved_for_pickup': 'approved_for_pickup',
    'approved for pickup': 'approved_for_pickup',
    'verified': 'approved_for_pickup',
    'accepted': 'approved_for_pickup',
    'rejected': 'rejected',
    'collected': 'collected',
    'pending': 'pending',
    'under_review': 'pending',
    'in_review': 'pending',
    'review': 'pending',
    'declined': 'rejected',
    'denied': 'rejected',
}


def normalize_claim_status(value):
    """Canonicalize legacy or non-standard values to the current claim schema."""
    raw = str(value or '').strip().lower()
    if not raw:
        return ''
    return LEGACY_CLAIM_STATUS_MAP.get(raw, raw)


def validate_claim_status_transition(current_status, next_status):
    """Validate the claim lifecycle and normalize legacy aliases before applying status changes."""
    current = normalize_claim_status(current_status)
    next_value = normalize_claim_status(next_status)

    if next_value not in {'approved_for_pickup', 'rejected', 'collected'}:
        raise ValueError(f"Unsupported claim status: {next_status}")

    if current == 'pending' and next_value not in {'approved_for_pickup', 'rejected'}:
        raise ValueError('Pending claims can only be approved for pickup or rejected')
    if current == 'approved_for_pickup' and next_value != 'collected':
        raise ValueError('Approved claims can only be marked collected')
    if current not in {'pending', 'approved_for_pickup'}:
        raise ValueError('This claim is already closed')

    return next_value
