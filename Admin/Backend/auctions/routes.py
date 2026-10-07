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
    result = service.eligible_items()
    if request.args.get('summary'):
        # The dashboard only needs "how many items are ready to auction" and how long the oldest has waited.
        items = result.get('items', [])
        return jsonify({'count': len(items), 'oldest_days': max((i.get('days_in_custody', 0) for i in items), default=0),
                        'min_custody_days': result.get('min_custody_days')}), 200
    return jsonify(result), 200


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


@auctions_bp.route('/auctions/<auction_id>/finalize', methods=['POST'])
@_handled('confirm the result')
def finalize_auction(auction_id):
    admin = _require_admin()
    db, service = _service()
    result = service.finalize(auction_id, admin['account_id'])
    auction = result['auction']
    finalized = result['outcome'] == 'finalized'
    _log_admin_action(db, admin, 'Finalize Auction' if finalized else 'Auction Cancelled At Finalize', 'Auctions', auction.get('title'), auction.get('item_reference') or auction_id)
    if finalized:
        email = service.winner_email_state(auction_id)
        suffix = {
            'sendgrid': ' A confirmation email was sent to the winner.',
            'mock': ' Email is in mock mode, so it was only logged. Set SENDGRID_API_KEY to send real emails.',
        }.get(email, ' The winner email could not be sent. Open the auction and use Resend winner email.' if email.endswith('_failed') else '')
        message = 'The result is confirmed. The winner was notified in the app and the item is waiting for pickup.' + suffix
    else:
        message = f"The auction was cancelled instead: {auction.get('cancel_reason')}"
    return jsonify({'success': True, 'outcome': result['outcome'], 'message': message}), 200


@auctions_bp.route('/auctions/<auction_id>/reauction', methods=['POST'])
@_handled('re-auction the item')
def reauction_auction(auction_id):
    admin = _require_admin()
    db, service = _service()
    payload = request.get_json(silent=True) or {}
    suspend_days = payload.get('suspend_days')
    if suspend_days not in (None, '', 0, '0'):
        try:
            suspend_days = int(suspend_days)
        except (TypeError, ValueError):
            raise AuctionError('Enter the suspension length in whole days.')
        if suspend_days < 1 or suspend_days > 365:
            raise AuctionError('A suspension must last between 1 and 365 days.')
    else:
        suspend_days = None

    result = service.reauction(auction_id, payload, admin['account_id'])
    old, new, winner_id = result['old'], result['new'], result.get('previous_winner_id')
    reference = old.get('item_reference') or auction_id
    _log_admin_action(db, admin, 'Re-Auction Item', 'Auctions', old.get('title'), reference)

    suspension = None
    if winner_id:
        try:
            target = db.get_user_by_account_id(str(winner_id)) or {}
            staff = str(target.get('access_level') or '').lower() in ('admin', 'super_admin')
            if suspend_days and (staff or str(winner_id) == admin['account_id']):
                suspension = {'applied': False, 'error': 'Admin accounts cannot be suspended from here.'}
            elif suspend_days:
                db.update_user_status(str(winner_id), 'suspended', days=suspend_days, reason=f'Did not complete an auction purchase ({reference}).', actor_id=admin['account_id'])
                _log_admin_action(db, admin, 'Suspend User for %d Days' % suspend_days, 'Users', target.get('email') or str(winner_id), str(winner_id))
                suspension = {'applied': True, 'days': suspend_days}
        except Exception as error:
            current_app.logger.warning('Re-auction suspension failed: %s', error)
            suspension = {'applied': False, 'error': str(error)}
        if not old.get('auto_forfeited_at'):  # after an automatic forfeit the scheduler has already told the winner
            try:
                extra = f' Your account is suspended for {suspend_days} days.' if suspension and suspension.get('applied') else ''
                db.create_user_notification(
                    str(winner_id), 'Auction purchase not completed',
                    f"Your winning bid on {old.get('title')} was not completed, so the item was listed again.{extra}",
                    notification_type='auction_forfeited', link_label='View auctions', link_page='auction-hall',
                )
            except Exception as error:
                current_app.logger.warning('Re-auction notification failed: %s', error)

    message = 'The item was listed again as a new auction.'
    if suspension and suspension.get('applied'):
        message += f" The previous winner is suspended for {suspension['days']} days."
    elif suspension and suspension.get('error'):
        message += f" The suspension could not be applied: {suspension['error']}"
    return jsonify({'success': True, 'message': message, 'auction_id': new.get('auction_id'), 'suspension': suspension}), 201


@auctions_bp.route('/auctions/<auction_id>/resend-winner-email', methods=['POST'])
@_handled('resend the winner email')
def resend_winner_email(auction_id):
    admin = _require_admin()
    db, service = _service()
    result = service.resend_winner_email(auction_id)
    row = result['auction']
    _log_admin_action(db, admin, 'Resend Auction Winner Email', 'Auctions', row.get('title'), row.get('item_reference') or auction_id)
    sent = result.get('sent')
    if result.get('mode') == 'mock':
        message = 'Mock mode: the email was logged on the server, not delivered. Set SENDGRID_API_KEY to send real emails.'
    else:
        message = 'The winner email was sent again.' if sent else 'The email could not be sent. Check the SendGrid settings.'
    return jsonify({'success': bool(sent), 'message': message, 'mode': result.get('mode')}), 200 if sent else 502


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
