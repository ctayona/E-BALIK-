"""System control page (super admin only): maintenance mode, forced logout, health scan and data cleanup, plus the Mission Control tools."""
from functools import wraps
from flask import Blueprint, Response, current_app, jsonify, request
from app.utils import get_db, rate_limit
from app.utils import mission_control as mission
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
            except mission.StorageUnavailable as error:
                return jsonify({'error': str(error), 'setup_required': True}), 503
            except mission.ToolError as error:
                return jsonify({'error': error.message, **error.extra}), error.status
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
        'announcement': settings['announcement'],
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


# ---------------------------------------------------------------------------------------------- Mission Control
def _limit(admin, name, count, seconds):
    if not rate_limit.allow(f"mission:{name}:{admin['account_id']}", count, seconds):
        raise mission.ToolError('You are doing that too often. Wait a few minutes and try again.', 429)


@system_control_bp.route('/system/announcement', methods=['PUT'])
@_super_admin_only('update the announcement')
def set_announcement(admin):
    db = _database()
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload.get('live'), bool):
        raise ValidationError('Choose whether the announcement is live.')
    try:
        value = control.set_announcement(db, payload['live'], payload.get('tone'), payload.get('title'), payload.get('message'), admin['account_id'])
    except ValueError as error:
        raise ValidationError(str(error))
    _log_admin_action(db, admin, 'Show Announcement Banner' if value['live'] else 'Hide Announcement Banner', 'System Control', value['title'] or value['message'][:60], 'announcement')
    return jsonify({'success': True, 'announcement': value, 'message': 'The announcement is LIVE on every page.' if value['live'] else 'The announcement was saved and is hidden.'}), 200


@system_control_bp.route('/system/users/search', methods=['GET'])
@_super_admin_only('search users')
def search_users(admin):
    return jsonify({'users': mission.search_users(_database(), request.args.get('q'))}), 200


@system_control_bp.route('/system/messages', methods=['POST'])
@_super_admin_only('send the message')
def send_message(admin):
    _limit(admin, 'message', 10, 3600)
    db = _database()
    payload = request.get_json(silent=True) or {}
    result = mission.send_message(db, payload.get('audience'), payload.get('account_id'), payload.get('title'), payload.get('message'), payload.get('send_email'), payload.get('send_in_app'))
    target = 'All users' if payload.get('audience') == 'all' else str(payload.get('account_id'))
    _log_admin_action(db, admin, 'Send Message', 'System Control', f"{target} ({result['recipients']} recipient(s))", 'message')
    parts = []
    if result['in_app']:
        parts.append(f"{result['in_app']:,} in-app notification(s)")
    if result.get('email_sent') is not None:
        parts.append(f"{result['email_sent']} email(s) sent" + (f", {result['email_failed']} failed" if result.get('email_failed') else ''))
    if result['email_queued']:
        parts.append(f"{result['email_queued']:,} email(s) are being sent in the background")
    if result['email_unavailable']:
        parts.append('email was skipped because the email service is not configured')
    return jsonify({'success': True, **result, 'message': 'Message sent: ' + '; '.join(parts) + '.'}), 200


@system_control_bp.route('/system/admins', methods=['GET'])
@_super_admin_only('load the administrators')
def list_admins(admin):
    return jsonify({'admins': mission.list_admins(_database()), 'you': admin['account_id']}), 200


@system_control_bp.route('/system/admins/<account_id>/revoke', methods=['POST'])
@_super_admin_only('revoke the access')
def revoke_admin(admin, account_id):
    _limit(admin, 'revoke', 20, 3600)
    db = _database()
    result = mission.revoke_admin(db, admin['account_id'], account_id)
    _log_admin_action(db, admin, 'Revoke Admin Access', 'System Control', f"{result['email'] or result['name']} ({result['previous_level']})", account_id)
    return jsonify({'success': True, **result, 'message': f"{result['name'] or 'The account'} is now a standard user. Their admin access ended immediately."}), 200


@system_control_bp.route('/system/export', methods=['GET'])
@_super_admin_only('export the data')
def export_data(admin):
    _limit(admin, 'export', 20, 3600)
    db = _database()
    kind = str(request.args.get('format') or 'json').lower()
    if kind not in ('json', 'csv'):
        raise ValidationError('Choose JSON or CSV.')
    export = mission.build_export(db, admin.get('email') or admin['account_id'])
    stamp = export['meta']['generated_at'][:10]
    _log_admin_action(db, admin, 'Export System Data', 'System Control', f"{kind.upper()} export ({export['summary']['users_total']} users)", 'export')
    if kind == 'csv':
        body, mimetype, name = mission.export_csv_zip(export), 'application/zip', f'ebalik-audit-export-{stamp}.zip'
    else:
        body, mimetype, name = mission.export_json(export), 'application/json', f'ebalik-audit-export-{stamp}.json'
    response = Response(body, mimetype=mimetype)
    response.headers['Content-Disposition'] = f'attachment; filename="{name}"'
    response.headers['Cache-Control'] = 'no-store'
    return response


@system_control_bp.route('/system/storage', methods=['GET'])
@_super_admin_only('load the storage statistics')
def storage(admin):
    return jsonify(mission.storage_overview(_database())), 200


@system_control_bp.route('/system/storage/scan', methods=['POST'])
@_super_admin_only('scan for orphaned images')
def storage_scan(admin):
    _limit(admin, 'storage-scan', 30, 3600)
    scan = mission.scan_orphans(_database())
    scan.pop('_objects', None)
    return jsonify(scan), 200


@system_control_bp.route('/system/storage/clean', methods=['POST'])
@_super_admin_only('clean the orphaned images')
def storage_clean(admin):
    _limit(admin, 'storage-clean', 10, 3600)
    db = _database()
    result = mission.clean_orphans(db)
    _log_admin_action(db, admin, 'Clean Orphaned Images', 'System Control', f"{result['removed']} image(s), {mission.humanize_bytes(result['freed_bytes'])}", 'storage_cleanup')
    return jsonify({'success': True, **result, 'message': f"Removed {result['removed']:,} orphaned image(s) and freed {mission.humanize_bytes(result['freed_bytes'])}." + (f" {result['failed']} could not be removed." if result['failed'] else '')}), 200


@system_control_bp.route('/system/email-test', methods=['POST'])
@_super_admin_only('send the test email')
def email_test(admin):
    _limit(admin, 'email-test', 10, 3600)
    db = _database()
    result = mission.send_test_email(db, admin['account_id'])
    _log_admin_action(db, admin, 'Send Test Email', 'System Control', f"{'OK' if result['ok'] else 'Failed'}: {result['to']}", 'email_test', result='success' if result['ok'] else 'failed')
    return jsonify(result), 200
