"""Browse Items page: public-safe missing report listing."""
from flask import Blueprint, current_app, jsonify
from app.utils import get_db
from Users.Backend.shared.request_auth import _authenticated_account_id

browse_items_bp = Blueprint('user_browse_items', __name__)


@browse_items_bp.route('/missing-items/public', methods=['GET'])
def list_public_missing_items():
    """List non-private fields for active missing reports."""
    try:
        _authenticated_account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        return jsonify({'items': db.get_public_missing_items()}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Public missing item listing error: {error}')
        return jsonify({'error': 'Unable to load missing item listings'}), 500
