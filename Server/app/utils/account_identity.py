"""Role-specific display identity derived from the permanent account UUID."""
from uuid import UUID

STAFF_PREFIXES = {'guard': 'GRD', 'admin': 'ADM', 'super_admin': 'SUP'}
AFFILIATION_PREFIXES = {'student': 'STU', 'faculty': 'FAC', 'staff': 'STF', 'others': 'OTH', 'visitor': 'OTH'}


def ebalik_id(profile):
    if not profile:
        return ''
    try:
        account = UUID(str(profile.get('account_id'))).hex.upper()
    except (ValueError, TypeError, AttributeError):
        return ''
    access = str(profile.get('access_level') or '').strip().lower()
    affiliation = str(profile.get('user_category') or profile.get('user_role') or '').strip().lower()
    prefix = STAFF_PREFIXES.get(access) or AFFILIATION_PREFIXES.get(affiliation, 'OTH')
    return f'{prefix}-{account}'
