"""System control page (super admin only): maintenance mode, forced logout, health scan and data cleanup."""
from functools import wraps
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils import system_control as control
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

system_control_bp = Blueprint('admin_system_control', __name__)


def _database():
    return get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])


def _super_admin_only(label):
    """Every route here needs a super admin, including reads. Maps auth and setup errors to JSON."""
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                admin = _require_admin(required_level='super_admin')
                return view(admin, *args, **kwargs)
            except control.SystemSetupRequired as error:
                return jsonify({'error': str(error), 'setup_required': True}), 503
            except PermissionError as error:
                return jsonify({'error': str(error)}), 403
            except ValueError as error:
                # Token problems come from _require_admin as ValueError; validation errors from the views are rewritten below.
                return jsonify({'error': str(error)}), 400 if getattr(error, 'validation', False) else 401
            except Exception as error:
                current_app.logger.exception('System control %s failed: %s', label, error)
                return jsonify({'error': f'Unable to {label}'}), 500
        return wrapper
    return decorator


class ValidationError(ValueError):
    validation = True


@system_control_bp.route('/system/overview', methods=['GET'])
@_super_admin_only('load system settings')
def overview(admin):
    db = _database()
    settings = control.load_settings(db, force=True)
    return jsonify({
        'maintenance': settings['maintenance_mode'],
        'sessions_valid_after': settings['sessions_valid_after'].get('ts'),
        'last_cleanup': settings['last_cleanup'] or None,
        'setup_required': control.settings_table_missing(),
        'min_cleanup_days': control.MIN_CLEANUP_DAYS,
    }), 200


@system_control_bp.route('/system/maintenance', methods=['PUT'])
@_super_admin_only('change maintenance mode')
def set_maintenance(admin):
    db = _database()
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload.get('enabled'), bool):
        raise ValidationError('Choose whether maintenance mode is on or off.')
    value = control.set_maintenance(db, payload['enabled'], payload.get('message') or '', admin['account_id'])
    _log_admin_action(db, admin, 'Enable Maintenance Mode' if value['enabled'] else 'Disable Maintenance Mode', 'System Control', 'Maintenance mode', 'maintenance_mode')
    message = 'Maintenance mode is ON. Standard users are locked out; admins can still sign in.' if value['enabled'] else 'Maintenance mode is OFF. Everyone can use E-Balik again.'
    return jsonify({'success': True, 'maintenance': value, 'message': message}), 200


@system_control_bp.route('/system/force-logout', methods=['POST'])
@_super_admin_only('force everyone to sign out')
def force_logout(admin):
    db = _database()
    stamp = control.force_logout(db, admin['account_id'])
    _log_admin_action(db, admin, 'Force Logout All Users', 'System Control', 'All standard user sessions', 'sessions_valid_after')
    return jsonify({'success': True, 'sessions_valid_after': stamp, 'message': 'All standard users were signed out. They must sign in again. Admin sessions were not affected.'}), 200


@system_control_bp.route('/system/health', methods=['GET'])
@_super_admin_only('run the health check')
def health(admin):
    db = _database()
    report = control.health_scan(db)
    _log_admin_action(db, admin, 'Run Health Check', 'System Control', f"Result: {report['status']}", 'health_scan')
    return jsonify(report), 200


def _cleanup_params(source):
    try:
        days = control.validate_days(source.get('days', control.MIN_CLEANUP_DAYS))
    except ValueError as error:
        raise ValidationError(str(error))
    flag = source.get('include_unread', False)
    include_unread = flag if isinstance(flag, bool) else str(flag).lower() in ('1', 'true', 'yes')
    return days, include_unread


@system_control_bp.route('/system/cleanup/preview', methods=['GET'])
@_super_admin_only('preview the cleanup')
def cleanup_preview(admin):
    days, include_unread = _cleanup_params(request.args)
    rows = control.cleanup_preview(_database(), days, include_unread)
    return jsonify({'days': days, 'include_unread': include_unread, 'targets': rows, 'total': sum(r['count'] for r in rows)}), 200


@system_control_bp.route('/system/cleanup', methods=['POST'])
@_super_admin_only('clean up the database')
def cleanup(admin):
    db = _database()
    payload = request.get_json(silent=True) or {}
    days, include_unread = _cleanup_params(payload)
    targets = payload.get('targets')
    if not isinstance(targets, list):
        raise ValidationError('Choose what to clean up.')
    try:
        summary = control.run_cleanup(db, days, include_unread, [str(t) for t in targets], admin['account_id'])
    except ValueError as error:
        raise ValidationError(str(error))
    total = sum(summary['deleted'].values())
    _log_admin_action(db, admin, 'Database Cleanup', 'System Control', f'{total} rows older than {days} days', 'cleanup')
    return jsonify({'success': True, 'summary': summary, 'message': f'Cleanup finished. {total:,} old record(s) were removed.'}), 200
