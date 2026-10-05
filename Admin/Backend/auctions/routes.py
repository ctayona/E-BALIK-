"""Auctions page: list eligible items, create and manage auctions, moderate comments, track pickup."""
from functools import wraps
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.auction_db import MAX_GALLERY_IMAGES, AuctionError, AuctionService, AuctionsUnavailable
from Admin.Backend.found_items.routes import _store_admin_item_photo
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

auctions_bp = Blueprint('admin_auctions', __name__)


def _service():
    db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
    return db, AuctionService(db)


def _handled(label):
    """Map auth, business-rule and setup errors to JSON responses so route bodies stay short."""
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
            except PermissionError as error:
                return jsonify({'error': str(error)}), 403
            except Exception as error:
                current_app.logger.exception('Admin auctions %s failed: %s', label, error)
                return jsonify({'error': f'Unable to {label}'}), 500
        return wrapper
    return decorator


def _resolve_gallery(db, admin, values):
    """Turn submitted photos into stored URLs: new uploads (data URLs) are saved, existing storage URLs are kept."""
    if values is None:
        return None
    if not isinstance(values, list) or len(values) > MAX_GALLERY_IMAGES:
        raise AuctionError(f'Add up to {MAX_GALLERY_IMAGES} extra photos.')
    base = str(current_app.config.get('SUPABASE_URL') or '').rstrip('/')
    urls = []
    for value in values:
        if isinstance(value, str) and value.startswith('data:'):
            try:
                stored = _store_admin_item_photo(db, value, 'found-item-images', admin['account_id'], 'auction')
            except ValueError as error:
                raise AuctionError(str(error))
            if stored:
                urls.append(stored)
        elif isinstance(value, str) and base and value.startswith(base + '/'):
            urls.append(value)
        else:
            raise AuctionError('One of the photos is not valid. Upload PNG or JPG images.')
    return urls


@auctions_bp.route('/auctions', methods=['GET'])
@_handled('load auctions')
def list_auctions():
    _require_admin()
    _, service = _service()
    return jsonify(service.admin_list()), 200


@auctions_bp.route('/auctions/eligible-items', methods=['GET'])
@_handled('load eligible items')
def eligible_items():
    _require_admin()
    _, service = _service()
    return jsonify(service.eligible_items()), 200


@auctions_bp.route('/auctions', methods=['POST'])
@_handled('create the auction')
def create_auction():
    admin = _require_admin()
    db, service = _service()
    payload = request.get_json(silent=True) or {}
    gallery = _resolve_gallery(db, admin, payload.get('gallery')) or []
    created = service.create_auction(payload, gallery, admin['account_id'])
    _log_admin_action(db, admin, 'Create Auction', 'Auctions', created.get('title'), created.get('item_reference') or created['auction_id'])
    return jsonify({'success': True, 'auction_id': created['auction_id'], 'message': 'The auction was created.'}), 201


@auctions_bp.route('/auctions/<auction_id>', methods=['GET'])
@_handled('load the auction')
def auction_detail(auction_id):
    _require_admin()
    _, service = _service()
    return jsonify(service.admin_detail(auction_id)), 200


@auctions_bp.route('/auctions/<auction_id>', methods=['PATCH'])
@_handled('update the auction')
def update_auction(auction_id):
    admin = _require_admin()
    db, service = _service()
    payload = request.get_json(silent=True) or {}
    gallery = _resolve_gallery(db, admin, payload.get('gallery')) if 'gallery' in payload else None
    updated = service.update_auction(auction_id, payload, gallery)
    _log_admin_action(db, admin, 'Update Auction', 'Auctions', updated.get('title'), updated.get('item_reference') or auction_id)
    return jsonify({'success': True, 'message': 'The auction was updated.'}), 200


@auctions_bp.route('/auctions/<auction_id>/cancel', methods=['POST'])
@_handled('cancel the auction')
def cancel_auction(auction_id):
    admin = _require_admin()
    db, service = _service()
    payload = request.get_json(silent=True) or {}
    cancelled = service.cancel_auction(auction_id, payload.get('reason'))
    _log_admin_action(db, admin, 'Cancel Auction', 'Auctions', cancelled.get('title'), cancelled.get('item_reference') or auction_id)
    return jsonify({'success': True, 'message': 'The auction was cancelled.'}), 200


@auctions_bp.route('/auctions/<auction_id>/end', methods=['POST'])
@_handled('end the auction')
def end_auction(auction_id):
    admin = _require_admin()
    db, service = _service()
    ended = service.end_now(auction_id)
    _log_admin_action(db, admin, 'End Auction Early', 'Auctions', ended.get('title'), ended.get('item_reference') or auction_id)
    message = 'The auction ended and the winner was notified.' if ended.get('winner_account_id') else 'The auction ended with no bids.'
    return jsonify({'success': True, 'message': message}), 200


@auctions_bp.route('/auctions/<auction_id>/fulfillment', methods=['POST'])
@_handled('update pickup status')
def update_fulfillment(auction_id):
    admin = _require_admin()
    db, service = _service()
    action = str((request.get_json(silent=True) or {}).get('action') or '').strip().lower()
    updated = service.set_fulfillment(auction_id, action)
    _log_admin_action(db, admin, 'Auction Collected' if action == 'collected' else 'Auction Forfeited', 'Auctions', updated.get('title'), updated.get('item_reference') or auction_id)
    message = 'Marked as collected.' if action == 'collected' else 'Marked as forfeited. The item is back in custody.'
    return jsonify({'success': True, 'message': message}), 200


@auctions_bp.route('/auctions/<auction_id>/comments/<comment_id>', methods=['PATCH'])
@_handled('moderate the comment')
def moderate_comment(auction_id, comment_id):
    admin = _require_admin()
    db, service = _service()
    hidden = bool((request.get_json(silent=True) or {}).get('hidden', True))
    if not service.set_comment_hidden(auction_id, comment_id, hidden, admin['account_id']):
        raise AuctionError('Comment not found.', 404)
    _log_admin_action(db, admin, 'Hide Auction Comment' if hidden else 'Restore Auction Comment', 'Auctions', auction_id, comment_id)
    return jsonify({'success': True, 'message': 'The comment was hidden.' if hidden else 'The comment is visible again.'}), 200


@auctions_bp.route('/auctions/<auction_id>', methods=['DELETE'])
@_handled('delete the auction')
def delete_auction(auction_id):
    admin = _require_admin(required_level='super_admin')
    db, service = _service()
    row = service.delete_auction(auction_id)
    _log_admin_action(db, admin, 'Delete Auction', 'Auctions', row.get('title'), row.get('item_reference') or auction_id)
    return jsonify({'success': True, 'message': 'The auction and its bids were deleted.'}), 200
