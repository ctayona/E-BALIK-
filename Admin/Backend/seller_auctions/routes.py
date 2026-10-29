"""Seller auctions (office side): reviewing what people want to sell, paying sellers after a sale, and the fee terms.

Reviews live under /auctions (the Auctions page) and payouts and terms under /income (Revenue and payments), so page access rules apply.
"""
from functools import wraps
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db, rate_limit
from app.utils.seller_auctions import SellerDesk, SellerError, SellerUnavailable
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

seller_auctions_bp = Blueprint('admin_seller_auctions', __name__)
MAX_UPLOAD_BYTES = 7 * 1024 * 1024


def _desk():
    db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
    return db, SellerDesk(db)


def _handled(label):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                return view(*args, **kwargs)
            except SellerError as error:
                return jsonify({'error': error.message, 'code': error.code}), error.status
            except SellerUnavailable as error:
                return jsonify({'error': str(error), 'code': 'setup_required', 'setup_required': True}), 503
            except ValueError as error:
                return jsonify({'error': str(error)}), 401
            except PermissionError as error:
                return jsonify({'error': str(error)}), 403
            except Exception as error:
                current_app.logger.exception('Seller auctions %s failed: %s', label, error)
                return jsonify({'error': f'Unable to {label}'}), 500
        return wrapper
    return decorator


# ---------------------------------------------------------------------------------------------- reviewing listings (Auctions page)
@seller_auctions_bp.route('/auctions/submissions', methods=['GET'])
@_handled('load the seller listings')
def list_submissions():
    _require_admin()
    _, desk = _desk()
    return jsonify(desk.admin_list(request.args.get('status', ''))), 200


@seller_auctions_bp.route('/auctions/submissions/<submission_id>/review', methods=['POST'])
@_handled('review the listing')
def review_submission(submission_id):
    admin = _require_admin()
    if not rate_limit.allow(f"seller-review:{admin['account_id']}", 120, 3600):
        raise SellerError('You are reviewing very quickly. Wait a few minutes and try again.', 429, 'rate_limited')
    db, desk = _desk()
    body = request.get_json(silent=True) or {}
    action = str(body.get('action') or '').strip().lower()
    listing = desk.review(admin['account_id'], submission_id, action, body)
    labels = {'approve': 'Approve Seller Listing', 'request_changes': 'Request Listing Changes', 'reject': 'Reject Seller Listing'}
    _log_admin_action(db, admin, labels.get(action, 'Review Seller Listing'), 'Auctions', listing['title'], f"SL-{listing['id'][:8].upper()}")
    messages = {'approve': 'The listing is approved and on the Auction Hall. The seller was told.',
                'request_changes': 'The seller was asked to change the listing.', 'reject': 'The listing was not accepted. The seller was told why.'}
    return jsonify({'success': True, 'listing': listing, 'message': messages.get(action, 'Saved.')}), 200


@seller_auctions_bp.route('/auctions/submissions/<submission_id>/return', methods=['POST'])
@_handled('mark the item returned')
def return_submission(submission_id):
    admin = _require_admin()
    db, desk = _desk()
    listing = desk.return_item(admin['account_id'], submission_id, (request.get_json(silent=True) or {}).get('note'))
    _log_admin_action(db, admin, 'Return Item To Seller', 'Auctions', listing['title'], f"SL-{listing['id'][:8].upper()}")
    return jsonify({'success': True, 'listing': listing, 'message': 'Marked as given back to the seller.'}), 200


# ---------------------------------------------------------------------------------------------- paying sellers (Revenue and payments)
@seller_auctions_bp.route('/income/payouts', methods=['GET'])
@_handled('load the seller payouts')
def list_payouts():
    _require_admin()
    _, desk = _desk()
    return jsonify(desk.payouts(request.args.get('status', ''))), 200


@seller_auctions_bp.route('/income/payouts/<payout_id>/pay', methods=['POST'])
@_handled('record the payout')
def pay_payout(payout_id):
    """An administrator sent the seller their money (cash at the office, or a GCash, Maya or bank transfer with its receipt image)."""
    admin = _require_admin()
    if not rate_limit.allow(f"seller-payout:{admin['account_id']}", 60, 3600):
        raise SellerError('You are recording payouts very quickly. Wait a few minutes and try again.', 429, 'rate_limited')
    if (request.content_length or 0) > MAX_UPLOAD_BYTES:
        raise SellerError('That image is too large. Use one under 5 MB.', 413, 'proof_too_large')
    if request.files or request.form:
        body = request.form.to_dict()
        upload = request.files.get('proof')
        proof = upload.read() if upload and upload.filename else b''
    else:
        body, proof = request.get_json(silent=True) or {}, b''
    db, desk = _desk()
    result = desk.pay(admin['account_id'], payout_id, body.get('method'), body.get('reference'), body.get('notes'), proof)
    payout, receipt = result['payout'], result['receipt'] or {}
    _log_admin_action(db, admin, 'Send Seller Payout', 'Income', f"{payout.get('title')}: ₱{float(payout.get('payout_amount') or 0):,.2f} by {payout.get('method')}", payout.get('receipt_no'))
    public = {k: v for k, v in receipt.items() if k != 'owner_id'}
    return jsonify({'success': True, 'message': f"Payout recorded. Receipt {payout.get('receipt_no')} was sent to the seller.", 'payout': payout, 'receipt': public}), 200


@seller_auctions_bp.route('/income/payouts/<payout_id>/proof', methods=['GET'])
@_handled('load the transfer receipt')
def payout_proof(payout_id):
    _require_admin()
    _, desk = _desk()
    url = desk.proof_url(payout_id)
    if not url:
        raise SellerError('No transfer receipt image was kept with this payout.', 404, 'not_found')
    return jsonify({'url': url}), 200


@seller_auctions_bp.route('/income/seller-terms', methods=['GET'])
@_handled('load the seller fee terms')
def get_terms():
    _require_admin()
    _, desk = _desk()
    return jsonify({'terms': desk.terms()}), 200


@seller_auctions_bp.route('/income/seller-terms', methods=['PUT'])
@_handled('save the seller fee terms')
def save_terms():
    """Super admins: the commission rate, minimum and cap, the payout hold and how many listings one seller may have at once."""
    admin = _require_admin(required_level='super_admin')
    db, desk = _desk()
    terms = desk.save_terms(request.get_json(silent=True) or {}, admin['account_id'])
    state = 'on' if terms['enabled'] else 'off'
    _log_admin_action(db, admin, 'Update Seller Fee Terms', 'Income', f"{terms['rate']:g}% (min ₱{terms['minimum']:,.2f}, cap ₱{terms['cap']:,.2f}), hold {terms['hold_days']} days, listings {state}", 'seller-terms')
    return jsonify({'success': True, 'terms': terms, 'message': 'Saved. New listings use these terms; listings already sent keep the terms they accepted.'}), 200

