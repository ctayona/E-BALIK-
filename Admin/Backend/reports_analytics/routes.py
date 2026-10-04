"""Reports & Analytics page: aggregated report data."""
from flask import Blueprint, current_app, jsonify
from app.utils import get_db
from Admin.Backend.shared.admin_access import _require_admin

reports_analytics_bp = Blueprint('admin_reports_analytics', __name__)


@reports_analytics_bp.route('/reports', methods=['GET'])
def admin_reports():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({
            'summary': db.get_admin_dashboard_summary(),
            **db.get_admin_analytics_breakdowns(),
        }), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin report aggregation error: %s', error)
        return jsonify({'error': 'Unable to load analytics reports'}), 500
