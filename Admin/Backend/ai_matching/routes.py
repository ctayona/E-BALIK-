"""AI Matching page: review, confirm and reject suggested matches."""
from flask import Blueprint, current_app, jsonify
from app.utils import get_db
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

ai_matching_bp = Blueprint('admin_ai_matching', __name__)


@ai_matching_bp.route('/ai-matches', methods=['GET'])
def list_ai_matches():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'matches': db.list_admin_ai_matches()}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Admin AI matches error: {error}')
        return jsonify({'error': 'Unable to load AI matches'}), 500


@ai_matching_bp.route('/ai-matches/<missing_id>/<found_id>/confirm', methods=['POST'])
def confirm_ai_match(missing_id, found_id):
    try:
        payload = _require_admin()
        admin_account_id = payload.get('account_id')
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        result = db.confirm_ai_match_and_notify(missing_id, found_id, confirmed_by_account_id=admin_account_id)
        _log_admin_action(db, payload, 'Confirm AI Match', 'AI Matching', f'{missing_id} ↔ {found_id}', f'{missing_id}:{found_id}')
        return jsonify(result), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception(f'Admin AI match confirm error: {error}')
        return jsonify({'error': 'Unable to confirm AI match', 'details': str(error)}), 500


@ai_matching_bp.route('/ai-matches/<missing_id>/<found_id>/reject', methods=['POST'])
def reject_ai_match(missing_id, found_id):
    try:
        payload = _require_admin()
        admin_account_id = payload.get('account_id')
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        result = db.reject_ai_match(missing_id, found_id, rejected_by_account_id=admin_account_id)
        _log_admin_action(db, payload, 'Reject AI Match', 'AI Matching', f'{missing_id} ↔ {found_id}', f'{missing_id}:{found_id}')
        return jsonify(result), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception(f'Admin AI match reject error: {error}')
        return jsonify({'error': 'Unable to reject AI match', 'details': str(error)}), 500
