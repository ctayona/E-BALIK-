"""Auction Hall, "Sell an item": a signed-in, verified user lists their own item, follows it, and sees what they will be paid."""
import json
from functools import wraps
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db, rate_limit
from app.utils.seller_auctions import MAX_PHOTO_BYTES, MAX_PHOTOS, SellerDesk, SellerError, SellerUnavailable
from Users.Backend.shared.request_auth import _authenticated_account_id

selling_bp = Blueprint('user_selling', __name__)
MAX_REQUEST_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES + 512 * 1024


def _desk():
    return SellerDesk(get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY']))


def _handled(label):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                reply = jsonify(view(*args, **kwargs))
                reply.headers['Cache-Control'] = 'no-store'
                return reply
            except SellerError as error:
                return jsonify({'error': error.message, 'code': error.code}), error.status
            except SellerUnavailable as error:
                return jsonify({'error': str(error), 'code': 'setup_required', 'setup_required': True}), 503
            except ValueError as error:
                return jsonify({'error': str(error)}), 401
            except Exception as error:
                current_app.logger.exception('Selling %s failed: %s', label, error)
                return jsonify({'error': f'Unable to {label}'}), 500
        return wrapper
    return decorator


def _form():
    """Listing fields plus up to MAX_PHOTOS photos (`photos`), read with a hard size cap."""
    if (request.content_length or 0) > MAX_REQUEST_BYTES:
        raise SellerError('The photos are too large together. Use smaller photos (5 MB each at most).', 413, 'too_large')
    photos = [upload.read(MAX_PHOTO_BYTES + 1) for upload in request.files.getlist('photos')[:MAX_PHOTOS + 1] if upload and upload.filename]
    if len(photos) > MAX_PHOTOS:
        raise SellerError(f'Add at most {MAX_PHOTOS} photos.', 400, 'too_many_photos')
    if any(len(p) > MAX_PHOTO_BYTES for p in photos):
        raise SellerError('Each photo must be 5 MB or smaller.', 400, 'photo_too_large')
    return request.form.to_dict(), photos


@selling_bp.route('/terms', methods=['GET'])
@_handled('load the selling rules')
def terms():
    """The fee and the rules, for anyone thinking about selling (no sign-in needed)."""
    return {'terms': _desk().terms()}


@selling_bp.route('', methods=['GET'])
@_handled('load your listings')
def mine():
    return _desk().mine(_authenticated_account_id())


@selling_bp.route('', methods=['POST'])
@_handled('send your listing')
def submit():
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'selling-submit:{account_id}', 6, 3600):
        raise SellerError('You sent several listings in a short time. Wait a while and try again.', 429, 'rate_limited')
    fields, photos = _form()
    listing = _desk().submit(account_id, fields, photos)
    return {'success': True, 'listing': listing, 'message': 'Your listing was sent. Bring the item to the Lost and Found Office so staff can check it and put it on the Auction Hall.'}


@selling_bp.route('/<submission_id>', methods=['PUT'])
@_handled('save your listing')
def update(submission_id):
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'selling-edit:{account_id}', 20, 3600):
        raise SellerError('You edited your listings many times in a short time. Wait a while and try again.', 429, 'rate_limited')
    fields, photos = _form()
    try:
        keep = json.loads(fields.get('keep_photos') or '[]')
    except ValueError:
        keep = []
    listing = _desk().update(account_id, submission_id, fields, photos, [k for k in keep if isinstance(k, str)] if isinstance(keep, list) else [])
    return {'success': True, 'listing': listing, 'message': 'Your listing was sent again for review.'}


@selling_bp.route('/<submission_id>/withdraw', methods=['POST'])
@_handled('withdraw your listing')
def withdraw(submission_id):
    listing = _desk().withdraw(_authenticated_account_id(), submission_id)
    return {'success': True, 'listing': listing, 'message': 'Your listing was withdrawn.'}
