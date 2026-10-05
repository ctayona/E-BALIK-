"""Auction Hall page: public feed, item detail, bidding and comments."""
from functools import wraps
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.auction_db import AuctionError, AuctionService, AuctionsUnavailable
from Users.Backend.shared.request_auth import _authenticated_account_id

auctions_bp = Blueprint('user_auctions', __name__)


def _service():
    db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
    return AuctionService(db)


def _optional_account_id():
    """Signed-in viewers get personal fields (leading, my bids); anonymous visitors still see the public auction."""
    try:
        return _authenticated_account_id()
    except Exception:
        return None


def _handled(label):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                return view(*args, **kwargs)
            except AuctionError as error:
                return jsonify({'error': error.message, **error.extra}), error.status
            except AuctionsUnavailable as error:
                return jsonify({'error': str(error), 'setup_required': True}), 503
            except ValueError as error:
                return jsonify({'error': str(error)}), 401
            except Exception as error:
                current_app.logger.exception('Auction Hall %s failed: %s', label, error)
                return jsonify({'error': f'Unable to {label}'}), 500
        return wrapper
    return decorator


@auctions_bp.route('', methods=['GET'])
@_handled('load auctions')
def list_auctions():
    return jsonify(_service().public_feed()), 200


@auctions_bp.route('/mine', methods=['GET'])
@_handled('load your bids')
def my_bids():
    return jsonify(_service().my_bids(_authenticated_account_id())), 200


@auctions_bp.route('/watching', methods=['GET'])
@_handled('load your hearts')
def my_reactions():
    return jsonify({'ids': _service().my_reaction_ids(_authenticated_account_id())}), 200


@auctions_bp.route('/<auction_id>/reaction', methods=['PUT', 'DELETE'])
@_handled('save your heart')
def set_reaction(auction_id):
    on = request.method == 'PUT'
    return jsonify({'success': True, **_service().set_reaction(auction_id, _authenticated_account_id(), on)}), 200


@auctions_bp.route('/<auction_id>', methods=['GET'])
@_handled('load the auction')
def auction_detail(auction_id):
    return jsonify(_service().public_detail(auction_id, _optional_account_id())), 200


@auctions_bp.route('/<auction_id>/bids', methods=['POST'])
@_handled('place the bid')
def place_bid(auction_id):
    account_id = _authenticated_account_id()
    amount = (request.get_json(silent=True) or {}).get('amount')
    service = _service()
    result = service.place_bid(auction_id, account_id, amount)
    message = 'Your bid was placed. The closing time was extended.' if result['extended'] else 'Your bid was placed. You are leading.'
    return jsonify({'success': True, 'message': message, **result}), 201


@auctions_bp.route('/<auction_id>/comments', methods=['POST'])
@_handled('post the comment')
def add_comment(auction_id):
    account_id = _authenticated_account_id()
    body = (request.get_json(silent=True) or {}).get('body')
    return jsonify({'success': True, 'comment': _service().add_comment(auction_id, account_id, body)}), 201


@auctions_bp.route('/<auction_id>/comments/<comment_id>', methods=['DELETE'])
@_handled('delete the comment')
def delete_comment(auction_id, comment_id):
    account_id = _authenticated_account_id()
    if not _service().delete_own_comment(auction_id, comment_id, account_id):
        raise AuctionError('Comment not found.', 404)
    return jsonify({'success': True}), 200
