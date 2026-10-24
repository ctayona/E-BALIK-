"""What a payer sees about paying: what they owe for an auction win or a Smart Tag, how to pay, and sending the receipt of a GCash, Maya or bank payment."""
from functools import wraps
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db, rate_limit
from app.utils.income import IncomeError, IncomeUnavailable
from app.utils.payments import PaymentDesk
from Users.Backend.shared.request_auth import _authenticated_account_id

payments_bp = Blueprint('user_payments', __name__)
MAX_UPLOAD_BYTES = 7 * 1024 * 1024


def _desk():
    return PaymentDesk(get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY']))


def _handled(label):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                reply = jsonify(view(*args, **kwargs))
                reply.headers['Cache-Control'] = 'no-store'
                return reply
            except IncomeError as error:
                return jsonify({'error': error.message, 'code': error.code}), error.status
            except IncomeUnavailable as error:
                return jsonify({'error': str(error), 'code': 'setup_required', 'setup_required': True}), 503
            except ValueError as error:
                return jsonify({'error': str(error)}), 401
            except Exception as error:
                current_app.logger.exception('Payments %s failed: %s', label, error)
                return jsonify({'error': f'Unable to {label}'}), 500
        return wrapper
    return decorator


@payments_bp.route('/mine', methods=['GET'])
@_handled('load your payments')
def my_payments():
    return _desk().my_payments(_authenticated_account_id())


@payments_bp.route('/proof', methods=['POST'])
@_handled('send the payment receipt')
def send_proof():
    """The payer sends the receipt image of a GCash, Maya or bank payment for their own auction win or Smart Tag. An administrator reviews it."""
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'payment-proof:{account_id}', 8, 3600):
        raise IncomeError('You sent several receipts in a short time. Wait a while and try again.', 429, 'rate_limited')
    if (request.content_length or 0) > MAX_UPLOAD_BYTES:
        raise IncomeError('That image is too large. Use one under 5 MB.', 413, 'proof_too_large')
    upload = request.files.get('image')
    form = request.form
    proof = _desk().submit_proof(account_id, form.get('source', ''), form.get('source_ref', ''), form.get('method', ''), form.get('reference', ''), form.get('note', ''), upload.read() if upload else b'')
    return {'success': True, 'message': 'Your receipt was sent. The office will confirm your payment after checking it.', 'proof': proof}
