"""Matches page: scored search of unclaimed found reports (also used by Dashboard, Browse Items, Missing Item)."""
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.matching import match_percentage
from Users.Backend.shared.request_auth import _authenticated_account_id

matches_bp = Blueprint('user_matches', __name__)


@matches_bp.route('/found-items/search', methods=['GET'])
def search_found_items():
    """Search unclaimed found reports and calculate optional missing-item match scores."""
    try:
        _authenticated_account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        missing_item = {
            'item_name': request.args.get('missing_item_name', ''),
            'category': request.args.get('missing_category', ''),
            'description': request.args.get('missing_description', ''),
            'distinctive_marks': request.args.get('missing_distinctive_marks', ''),
            'last_location': request.args.get('missing_location', ''),
            'last_seen_date': request.args.get('missing_date', ''),
        }
        found_items = db.search_found_items(
            category=request.args.get('category', '').strip(),
            location=request.args.get('location', '').strip(),
            found_date=request.args.get('found_date', '').strip(),
            query=request.args.get('query', '').strip(),
        )
        results = [{**item, 'match_percentage': match_percentage(missing_item, item)} for item in found_items]
        results.sort(key=lambda item: (item['match_percentage'], item.get('created_at', '')), reverse=True)
        return jsonify({'items': results}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Found item search error: {error}')
        return jsonify({'error': 'Unable to search found item reports'}), 500
