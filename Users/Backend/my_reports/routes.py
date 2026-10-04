"""My Reports page: owner-scoped edit and delete of found and missing reports."""
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from Users.Backend.shared.request_auth import _authenticated_account_id

my_reports_bp = Blueprint('user_my_reports', __name__)


@my_reports_bp.route('/found-items/<fpost_id>', methods=['PUT', 'DELETE'])
def manage_found_item(fpost_id):
    try:
        account_id = _authenticated_account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if request.method == 'DELETE':
            return jsonify({'deleted': db.delete_found_item_by_account(fpost_id, account_id)}), 200
        item = db.update_found_item_by_account(fpost_id, account_id, request.get_json(silent=True) or {})
        if not item:
            return jsonify({'error': 'Report not found or not owned by this account'}), 404
        return jsonify({'item': item}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Found item management error: {error}')
        return jsonify({'error': 'Unable to update found item report'}), 500


@my_reports_bp.route('/missing-items/<mpost_id>', methods=['PUT', 'DELETE'])
def manage_missing_item(mpost_id):
    try:
        account_id = _authenticated_account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if request.method == 'DELETE':
            return jsonify({'deleted': db.delete_missing_item_by_account(mpost_id, account_id)}), 200
        item = db.update_missing_item_by_account(mpost_id, account_id, request.get_json(silent=True) or {})
        if not item:
            return jsonify({'error': 'Report not found or not owned by this account'}), 404
        return jsonify({'item': item}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Missing item management error: {error}')
        return jsonify({'error': 'Unable to update missing item report'}), 500
