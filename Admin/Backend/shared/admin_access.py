"""Admin authentication and audit helpers shared by every admin page."""
from flask import current_app, jsonify, request
from app.utils import get_db, JWTService


def _require_admin(required_level='admin'):
    auth_header = request.headers.get('Authorization', '')
    token = JWTService.extract_token_from_header(auth_header)
    payload = JWTService.verify_token(token)
    account_id = payload.get('account_id')
    if not account_id:
        raise ValueError('Token does not contain an account id')
    db = get_db(
        url=current_app.config['SUPABASE_URL'],
        service_key=current_app.config['SUPABASE_SERVICE_KEY']
    )
    profile = db.get_user_by_account_id(account_id)
    if not profile or profile.get('is_active') is False:
        raise PermissionError('Active administrator access required')
    access_level = str(profile.get('access_level') or '').strip().lower()
    if access_level not in {'user', 'guard', 'admin', 'super_admin'}:
        legacy_role = str(profile.get('user_role') or '').strip().lower()
        access_level = 'admin' if legacy_role == 'admin' else 'super_admin' if legacy_role == 'super_admin' else 'user'
    if required_level == 'super_admin' and access_level != 'super_admin':
        raise PermissionError('Super administrator access required')
    # Role access (Users > Role access) and page locks (System control). A guard may use an admin API only when a super
    # administrator granted guards a page that owns it; an administrator loses the APIs of pages taken away or locked.
    from app.utils.access_control import admin_path_problem, guard_may_use
    from app.utils.system_control import load_settings
    admin_path = request.path[len('/api/admin'):] if request.path.startswith('/api/admin') else ''
    try:
        settings = load_settings(db)
    except Exception:
        settings = {}
    if required_level == 'admin' and access_level not in {'admin', 'super_admin'}:
        if not (access_level == 'guard' and admin_path and guard_may_use(settings, admin_path)):
            raise PermissionError('Admin access required')
    if access_level in {'admin', 'guard'} and required_level != 'super_admin':
        problem = admin_path_problem(settings, access_level, admin_path)
        if problem:
            raise PermissionError(problem)
    # 'guard' is the lowest staff level: the release desk. It also admits admins, but no admin page admits a guard.
    if required_level == 'guard' and access_level not in {'guard', 'admin', 'super_admin'}:
        raise PermissionError('Guard or administrator access required')
    mfa_record = db.get_admin_mfa(account_id)
    if mfa_record and mfa_record.get('enabled_at') and payload.get('admin_mfa_verified') is not True:
        raise PermissionError('Authenticator verification required')
    if mfa_record and payload.get('admin_mfa_verified') is True:
        token_generation = payload.get('admin_mfa_generation')
        if token_generation is None or int(token_generation) != int(mfa_record.get('session_generation') or 0):
            raise PermissionError('Admin session was revoked by a security-setting change. Sign in again.')
    payload['access_level'] = access_level
    return payload


def _log_admin_action(db, actor, action, module, target, target_id, result='success'):
    db.log_user_activity(
        account_id=actor['account_id'],
        user_name=actor.get('email') or 'Admin',
        action=action,
        module=module,
        target_name=target,
        target_id=target_id,
        result=result,
    )


def enforce_super_admin_for_deletes():
    """Blueprint guard (before_request): every DELETE under /api/admin requires a super administrator.

    Applied to all admin blueprints in app/blueprints.py so new delete routes are protected automatically,
    in addition to each route's own check and the super_admin checks inside the database RPCs.
    """
    if request.method != 'DELETE':
        return None
    try:
        _require_admin(required_level='super_admin')
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError:
        return jsonify({'error': 'Only super administrators can delete records'}), 403
    except Exception as error:
        current_app.logger.exception('Delete permission check failed: %s', error)
        return jsonify({'error': 'Unable to verify administrator access'}), 500
    return None
