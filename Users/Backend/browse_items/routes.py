"""Browse Items page: public-safe missing report listing."""
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db, image_match, rate_limit
from Users.Backend.shared.uploads import has_valid_signature
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


PHOTO_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
MAX_SEARCH_PHOTO_BYTES = 6 * 1024 * 1024


@browse_items_bp.route('/found-items/photo-search', methods=['POST'])
def photo_search():
    """Search items at the office by a photo of what you lost. Only the fields Browse already shows are returned (never who found it)."""
    try:
        account_id = _authenticated_account_id()
        if not rate_limit.allow(f'photo-search:{account_id}', 12, 600):
            return jsonify({'error': 'You searched a lot in a short time. Wait a few minutes and try again.'}), 429
        upload = request.files.get('image')
        if not upload or not upload.filename:
            return jsonify({'error': 'Choose or take a photo first.'}), 400
        data = upload.read(MAX_SEARCH_PHOTO_BYTES + 1)
        if len(data) > MAX_SEARCH_PHOTO_BYTES:
            return jsonify({'error': 'That photo is larger than 6 MB. Use a smaller one.'}), 400
        if upload.mimetype not in PHOTO_TYPES or not has_valid_signature(data, upload.mimetype):
            return jsonify({'error': 'Use a JPG, PNG or WEBP photo.'}), 400
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        try:
            outcome = image_match.search(db, data)
        except ValueError as error:
            return jsonify({'error': str(error)}), 400
        reply = jsonify(outcome)
        reply.headers['Cache-Control'] = 'no-store'
        return reply, 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.exception('Photo search failed: %s', error)
        return jsonify({'error': 'Unable to search by photo right now'}), 500
