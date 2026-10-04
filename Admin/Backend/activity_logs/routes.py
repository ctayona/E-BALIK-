"""Activity Logs page: user and administrator activity (also read by Notifications)."""
from flask import Blueprint, current_app, jsonify
from app.utils import get_db
from Admin.Backend.shared.admin_access import _require_admin

activity_logs_bp = Blueprint('admin_activity_logs', __name__)


@activity_logs_bp.route('/activity-logs', methods=['GET'])
def list_activity_logs():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'logs': db.get_activity_logs_for_actor_type(include_admins=False, limit=100)}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Admin activity logs error: {error}')
        return jsonify({'error': 'Unable to load activity logs'}), 500


@activity_logs_bp.route('/admin-activity-logs', methods=['GET'])
def list_admin_activity_logs():
    try:
        _require_admin(required_level='super_admin')
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'logs': db.get_activity_logs_for_actor_type(include_admins=True, limit=200)}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Superadmin activity log listing error: %s', error)
        return jsonify({'error': 'Unable to load administrator activity logs'}), 500
