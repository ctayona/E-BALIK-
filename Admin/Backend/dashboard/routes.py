"""Admin Dashboard page: summary metrics."""
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.admin_badges import nav_badges
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


@dashboard_bp.route('/nav-badges', methods=['GET'])
def menu_badges():
    """How many items wait for an administrator on each menu page (claims, ID verifications, Smart Tags, auctions)."""
    try:
        _require_admin()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        return jsonify(nav_badges(db.client)), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Admin menu badges error: {error}')
        return jsonify({'error': 'Unable to load the menu badges'}), 500


@dashboard_bp.route('/dashboard/analytics', methods=['GET'])
def dashboard_analytics():
    """Charts for the dashboard: lost-item categories, busiest days and months, and how found items ended up."""
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        from app.utils.analytics import RangeError, collect_visual_analytics
        try:
            data = collect_visual_analytics(db, request.args.get('range'), request.args.get('start'), request.args.get('end'))
        except RangeError as error:
            return jsonify({'error': str(error)}), 400
        return jsonify(data), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin visual analytics error: %s', error)
        return jsonify({'error': 'Unable to load analytics'}), 500
