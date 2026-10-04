"""Admin Dashboard page: summary metrics."""
from flask import Blueprint, current_app, jsonify
from app.utils import get_db
from Admin.Backend.shared.admin_access import _require_admin

dashboard_bp = Blueprint('admin_dashboard', __name__)


@dashboard_bp.route('/dashboard', methods=['GET'])
def dashboard_summary():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify(db.get_admin_dashboard_summary()), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Admin dashboard error: {error}')
        return jsonify({'error': 'Unable to load dashboard summary'}), 500
