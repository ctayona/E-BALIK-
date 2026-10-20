"""Receipts: the owner's digital proof that an item was released to them, and a public check that a receipt is genuine."""
from functools import wraps
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db, rate_limit
from app.utils import receipts
from Users.Backend.shared.request_auth import _authenticated_account_id

receipts_bp = Blueprint('user_receipts', __name__)


def _db():
    return get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])


def _client_ip() -> str:
    forwarded = request.headers.get('X-Forwarded-For', '')
    return (forwarded.split(',')[-1].strip() if forwarded else '') or request.remote_addr or 'unknown'


def _handled(label):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                reply = view(*args, **kwargs)
                body, status = reply if isinstance(reply, tuple) else (reply, 200)
                response = jsonify(body)
                response.status_code = status
                response.headers['Cache-Control'] = 'no-store'
                return response
            except receipts.ReceiptError as error:
                return jsonify({'error': error.message}), error.status
            except ValueError as error:
                return jsonify({'error': str(error)}), 401
            except Exception as error:
                current_app.logger.exception('Receipts %s failed: %s', label, error)
                return jsonify({'error': f'Unable to {label}'}), 500
        return wrapper
    return decorator


@receipts_bp.route('', methods=['GET'])
@_handled('load your receipts')
def my_receipts():
    return {'receipts': [{k: v for k, v in receipt.items() if k != 'owner_id'} for receipt in receipts.list_for_owner(_db(), _authenticated_account_id())]}


@receipts_bp.route('/verify', methods=['POST'])
@_handled('check the receipt')
def verify_receipt():
    """Public: a receipt number and its code. Answers genuine or not, with only the item and the day. Throttled per address."""
    if not rate_limit.allow(f'receipt-verify:{_client_ip()}', 20, 600):
        return {'error': 'Too many checks. Wait a few minutes and try again.'}, 429
    body = request.get_json(silent=True) or {}
    return receipts.verify(_db(), body.get('receipt_no'), body.get('code'))


@receipts_bp.route('/<receipt_no>', methods=['GET'])
@_handled('load the receipt')
def one_receipt(receipt_no):
    return {'receipt': receipts.get_for_owner(_db(), _authenticated_account_id(), receipt_no)}
