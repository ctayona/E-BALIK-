"""Admin authentication and audit helpers shared by every admin page."""
from flask import current_app, request
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
    if access_level not in {'user', 'admin', 'super_admin'}:
        legacy_role = str(profile.get('user_role') or '').strip().lower()
        access_level = 'admin' if legacy_role == 'admin' else 'super_admin' if legacy_role == 'super_admin' else 'user'
    if required_level == 'super_admin' and access_level != 'super_admin':
        raise PermissionError('Super administrator access required')
    if required_level == 'admin' and access_level not in {'admin', 'super_admin'}:
        raise PermissionError('Admin access required')
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
