"""Who may open which admin page (RBAC), and which pages are locked while they are being fixed (page isolation).

Both live in `system_settings` (no migration): `rbac` = {'admin': [page ids], 'guard': [page ids]} and
`page_locks` = {'user': {page: {...}}, 'admin': {page: {...}}}. A super administrator always has every page and is never
locked out, so the people fixing a page can still open and test it.

Enforcement happens in three places that agree with each other:
  * the admin API: `admin_path_problem` (called from `_require_admin`) refuses a request whose API belongs only to pages the
    caller may not open, or only to locked pages;
  * the user API: `user_path_lock` (called from the request hook) refuses the writes and reads that belong to a locked user page;
  * both apps hide or replace the pages themselves (`GET /api/admin/access/me` for the console, `GET /api/system/status` for users).
"""
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

# ------------------------------------------------------------------------------------------------ admin pages
# id, label, the admin API prefixes the page needs (under /api/admin), who may be given it.
#   'super' pages are super-admin only and cannot be granted. 'always' pages cannot be taken away.
ADMIN_PAGES: List[Dict[str, Any]] = [
    {'id': 'dashboard', 'label': 'Dashboard', 'api': ['/dashboard', '/nav-badges'], 'always': True},
    {'id': 'report-hub', 'label': 'Reports', 'api': ['/lost-items', '/found-items', '/archive', '/claims', '/auctions', '/report-comments']},
    {'id': 'ai-matching', 'label': 'AI matching', 'api': ['/ai-matches', '/lost-items', '/found-items']},
    {'id': 'auctions', 'label': 'Auctions', 'api': ['/auctions', '/found-items']},
    {'id': 'smart-tags', 'label': 'Smart tags', 'api': ['/smart-tags']},
    {'id': 'claims', 'label': 'Claims and verification', 'api': ['/claims', '/account-verifications']},
    {'id': 'release-desk', 'label': 'Release desk', 'api': ['/claims/handover']},
    {'id': 'users', 'label': 'Users', 'api': ['/users', '/account-verifications', '/access']},
    {'id': 'reports', 'label': 'Analytics', 'api': ['/reports', '/dashboard']},
    {'id': 'income', 'label': 'Revenue and payments', 'api': ['/income']},
    {'id': 'notifications', 'label': 'Notifications', 'api': ['/activity-logs', '/claims']},
    {'id': 'activity-logs', 'label': 'Activity logs', 'api': ['/activity-logs', '/admin-activity-logs']},
    {'id': 'system-control', 'label': 'System control', 'api': ['/system'], 'super': True},
    {'id': 'recycle-bin', 'label': 'Recycle bin', 'api': ['/recycle-bin'], 'super': True},
    {'id': 'admin-profile', 'label': 'My profile', 'api': ['/mfa'], 'always': True},
]
ADMIN_PAGE_IDS = [page['id'] for page in ADMIN_PAGES]
GRANTABLE = [page['id'] for page in ADMIN_PAGES if not page.get('super') and not page.get('always')]
ALWAYS = [page['id'] for page in ADMIN_PAGES if page.get('always')]
# Answer "what may I open?" and the shell's own needs, whatever the matrix says.
OPEN_ADMIN_PREFIXES = ('/access/me', '/dashboard', '/nav-badges', '/mfa')
ROLES = ('admin', 'guard')
DEFAULT_RBAC: Dict[str, List[str]] = {
    'admin': list(GRANTABLE),          # today's behaviour: an administrator sees every page except the super-admin ones
    'guard': ['release-desk'],         # today's behaviour: a guard sees the release desk only
}

# ------------------------------------------------------------------------------------------------ user pages
# id, label, and the user API calls that belong to the page: (methods or None for all, path pattern under /api).
USER_PAGES: List[Dict[str, Any]] = [
    {'id': 'dashboard', 'label': 'Home feed', 'api': [(None, r'^/feed(/|$)')]},
    {'id': 'report-item', 'label': 'Report an item', 'api': [({'POST'}, r'^/(found-items|missing-items)/?$')]},
    {'id': 'found-item', 'label': 'Report a found item', 'api': [({'POST'}, r'^/found-items/?$')]},
    {'id': 'missing-item', 'label': 'Report a lost item', 'api': [({'POST'}, r'^/missing-items/?$')]},
    {'id': 'my-reports', 'label': 'My reports', 'api': [({'PUT', 'DELETE'}, r'^/(found-items|missing-items)/[^/]+$')]},
    {'id': 'matches', 'label': 'Matches', 'api': [({'GET'}, r'^/(found-items|missing-items)/matches$')]},
    {'id': 'browse-items', 'label': 'Browse items', 'api': [({'GET'}, r'^/missing-items/public$')]},
    {'id': 'claim', 'label': 'Claims', 'api': [(None, r'^/claims(/|$)')]},
    {'id': 'auction-hall', 'label': 'Auction Hall', 'api': [(None, r'^/auctions(/|$)')]},
    # The public scan page (GET /tags/<code> and "I found this item") keeps working: a finder must always reach the owner.
    {'id': 'my-tags', 'label': 'Smart Tags', 'api': [(None, r'^/tags/(mine|contacts)$'), (None, r'^/tags/[^/]+/(claim|photo|qr)$'), ({'PATCH'}, r'^/tags/[^/]+$')]},
    {'id': 'notifications', 'label': 'Notifications', 'api': []},
    {'id': 'profile', 'label': 'Profile', 'api': []},
]
USER_PAGE_IDS = [page['id'] for page in USER_PAGES]
_USER_PATTERNS: List[Tuple[str, Optional[set], re.Pattern]] = [
    (page['id'], methods, re.compile(pattern)) for page in USER_PAGES for methods, pattern in page['api']
]
MAX_LOCK_MESSAGE = 240


class AccessError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message, self.status = message, status


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value: Any, limit: int) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[<>\x00-\x1f\x7f]', '', str(value or ''))).strip()[:limit]


def _label(pages: Iterable[Dict[str, Any]], page_id: str) -> str:
    return next((page['label'] for page in pages if page['id'] == page_id), page_id)


# ------------------------------------------------------------------------------------------------ reading settings
def rbac_matrix(settings: Dict[str, Dict[str, Any]]) -> Dict[str, List[str]]:
    """The saved matrix over the defaults, limited to pages that can be granted (plus the always-open ones)."""
    stored = settings.get('rbac') or {}
    matrix: Dict[str, List[str]] = {}
    for role in ROLES:
        chosen = stored.get(role)
        pages = DEFAULT_RBAC[role] if not isinstance(chosen, list) else [page for page in chosen if page in GRANTABLE]
        # Administrators always keep the dashboard and their profile. Guards get only what was granted (their desk has its own header).
        always = set(ALWAYS) if role == 'admin' else set()
        matrix[role] = sorted(set(pages) | always, key=ADMIN_PAGE_IDS.index)
    return matrix


def page_locks(settings: Dict[str, Dict[str, Any]], area: str) -> Dict[str, Dict[str, Any]]:
    stored = (settings.get('page_locks') or {}).get(area) or {}
    valid = USER_PAGE_IDS if area == 'user' else ADMIN_PAGE_IDS
    return {page: dict(lock) for page, lock in stored.items() if page in valid and isinstance(lock, dict)}


def allowed_admin_pages(settings: Dict[str, Dict[str, Any]], level: str) -> List[str]:
    if level == 'super_admin':
        return list(ADMIN_PAGE_IDS)
    if level not in ROLES:
        return []
    return rbac_matrix(settings)[level]


def access_summary(settings: Dict[str, Dict[str, Any]], level: str) -> Dict[str, Any]:
    """What the console shell needs: the pages this person may open, and which admin pages are locked (with the message)."""
    locks = page_locks(settings, 'admin')
    return {
        'level': level,
        'pages': allowed_admin_pages(settings, level),
        'locked': {page: {'message': lock.get('message') or '', 'since': lock.get('since')} for page, lock in locks.items()},
        'bypass_locks': level == 'super_admin',
    }


# ------------------------------------------------------------------------------------------------ enforcement
def admin_path_problem(settings: Dict[str, Dict[str, Any]], level: str, admin_path: str) -> Optional[str]:
    """None when this person may call `admin_path` (the part after /api/admin), else the reason to show.

    The API is allowed when at least one page that needs it is open to the person and not locked. Super admins pass.
    """
    if level == 'super_admin' or not admin_path:
        return None
    if any(admin_path == prefix or admin_path.startswith(prefix + '/') or admin_path.startswith(prefix + '?') for prefix in OPEN_ADMIN_PREFIXES):
        return None
    owners = [page for page in ADMIN_PAGES if any(admin_path == p or admin_path.startswith(p + '/') for p in page['api'])]
    if not owners:
        return None  # an API no page claims (new or shared) keeps its own route-level checks
    allowed = set(allowed_admin_pages(settings, level))
    locks = page_locks(settings, 'admin')
    granted = [page for page in owners if page['id'] in allowed]
    if not granted:
        return f"Your role does not have access to {owners[0]['label']}. Ask a super administrator to grant it in Users > Role access."
    if all(page['id'] in locks for page in granted):
        lock = locks[granted[0]['id']]
        return lock.get('message') or f"{granted[0]['label']} is locked while it is being fixed. Try again later."
    return None


def guard_may_use(settings: Dict[str, Dict[str, Any]], admin_path: str) -> bool:
    """A guard calling an admin-level API: allowed only when a page granted to guards owns it."""
    granted = set(rbac_matrix(settings)['guard'])
    return any(page['id'] in granted and any(admin_path == p or admin_path.startswith(p + '/') for p in page['api']) for page in ADMIN_PAGES if not page.get('super'))


def user_path_lock(settings: Dict[str, Dict[str, Any]], method: str, api_path: str) -> Optional[Tuple[str, str]]:
    """(page id, message) when this user API call belongs to a locked user page, else None. `api_path` is after /api."""
    locks = page_locks(settings, 'user')
    if not locks:
        return None
    for page_id, methods, pattern in _USER_PATTERNS:
        if page_id in locks and (methods is None or method in methods) and pattern.match(api_path):
            label = _label(USER_PAGES, page_id)
            return page_id, locks[page_id].get('message') or f'{label} is temporarily unavailable while we fix something. Please try again later.'
    return None


# ------------------------------------------------------------------------------------------------ changing settings
def validate_rbac(payload: Any) -> Dict[str, List[str]]:
    if not isinstance(payload, dict):
        raise AccessError('Send the pages each role may open.')
    matrix: Dict[str, List[str]] = {}
    for role in ROLES:
        pages = payload.get(role)
        if not isinstance(pages, list) or not all(isinstance(page, str) for page in pages):
            raise AccessError(f'Choose the pages for the {role} role.')
        unknown = [page for page in pages if page not in ADMIN_PAGE_IDS]
        if unknown:
            raise AccessError(f'Unknown page: {unknown[0]}.')
        matrix[role] = [page for page in ADMIN_PAGE_IDS if page in pages and page in GRANTABLE]
    if 'release-desk' not in matrix['guard']:
        raise AccessError('Guards always need the Release desk: it is the only way to hand items back.')
    return matrix


def set_lock(current: Dict[str, Any], area: str, page: str, locked: bool, message: Any, actor_id: str) -> Dict[str, Any]:
    """The new `page_locks` value after locking or unlocking one page. System control itself can never be locked."""
    if area not in ('user', 'admin'):
        raise AccessError('Choose the user site or the admin console.')
    valid = USER_PAGE_IDS if area == 'user' else ADMIN_PAGE_IDS
    if page not in valid:
        raise AccessError('That page does not exist.')
    if area == 'admin' and page in ('system-control', 'admin-profile', 'dashboard'):
        raise AccessError('This page cannot be locked: it is needed to unlock the others.' if page == 'system-control' else 'This page cannot be locked.')
    value = {'user': dict((current or {}).get('user') or {}), 'admin': dict((current or {}).get('admin') or {})}
    if locked:
        text = _clean_text(message, MAX_LOCK_MESSAGE)
        value[area][page] = {'message': text, 'since': _now_iso(), 'by': actor_id}
    else:
        value[area].pop(page, None)
    return value


def catalog() -> Dict[str, Any]:
    """Page lists for the admin screens (labels, and which admin pages can be granted, are fixed or are super only)."""
    return {
        'admin_pages': [{'id': p['id'], 'label': p['label'], 'grantable': p['id'] in GRANTABLE, 'always': bool(p.get('always')), 'super_only': bool(p.get('super'))} for p in ADMIN_PAGES],
        'user_pages': [{'id': p['id'], 'label': p['label'], 'api_locked': bool(p['api'])} for p in USER_PAGES],
        'roles': list(ROLES),
    }
