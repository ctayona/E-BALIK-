"""Revenue and payments: what the Auction Hall and Smart Tags earned, what is waiting for payment confirmation, and the ledger behind every number.

Administrators read it and confirm payments (each confirmation issues a receipt). Only super administrators add manual entries and reverse payments.
"""
from functools import wraps
from flask import Blueprint, Response, current_app, jsonify, request
from app.utils import get_db, rate_limit, receipts
from app.utils.income import IncomeError, IncomeService, IncomeUnavailable
from app.utils.payments import PaymentDesk
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

income_bp = Blueprint('admin_income', __name__)


def _service():
    db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
    return db, IncomeService(db)


def _handled(label):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                return view(*args, **kwargs)
            except IncomeError as error:
                return jsonify({'error': error.message, 'code': error.code}), error.status
            except IncomeUnavailable as error:
                return jsonify({'error': str(error), 'code': 'setup_required', 'setup_required': True}), 503
            except ValueError as error:
                return jsonify({'error': str(error)}), 401
            except PermissionError as error:
                return jsonify({'error': str(error)}), 403
            except Exception as error:
                current_app.logger.exception('Income %s failed: %s', label, error)
                return jsonify({'error': f'Unable to {label}'}), 500
        return wrapper
    return decorator


@income_bp.route('/income/summary', methods=['GET'])
@_handled('load the income summary')
def summary():
    _require_admin()
    _, service = _service()
    return jsonify(service.summary(request.args.get('start'), request.args.get('end'))), 200


@income_bp.route('/income/entries', methods=['GET'])
@_handled('load the income ledger')
def entries():
    _require_admin()
    _, service = _service()
    args = request.args
    return jsonify(service.entries(args.get('start'), args.get('end'), args.get('source', ''), args.get('limit', 50), args.get('offset', 0))), 200


@income_bp.route('/income/entries', methods=['POST'])
@_handled('record the entry')
def add_entry():
    admin = _require_admin(required_level='super_admin')
    db, service = _service()
    entry = service.record_manual(request.get_json(silent=True) or {}, admin['account_id'])
    _log_admin_action(db, admin, 'Record Income Entry', 'Income', f"{entry.get('kind')} ₱{float(entry.get('amount') or 0):,.2f}: {entry.get('description')}", str(entry.get('entry_id') or ''))
    return jsonify({'success': True, 'entry': entry, 'message': 'The entry was added to the income ledger.'}), 201


@income_bp.route('/income/export', methods=['GET'])
@_handled('export the income ledger')
def export():
    admin = _require_admin()
    db, service = _service()
    args = request.args
    body = service.csv_export(args.get('start'), args.get('end'), args.get('source', ''))
    _log_admin_action(db, admin, 'Export Income Ledger', 'Income', f"{args.get('start') or 'start'} to {args.get('end') or 'today'}", 'income')
    reply = Response('﻿' + body, mimetype='text/csv')  # the BOM lets Excel read the peso sign and accents
    reply.headers['Content-Disposition'] = 'attachment; filename="ebalik-income.csv"'
    reply.headers['Cache-Control'] = 'no-store'
    return reply


# ---------------------------------------------------------------------------------------------- payment confirmation
def _public(receipt):
    return {k: v for k, v in (receipt or {}).items() if k != 'owner_id'}


MAX_CONFIRM_BYTES = 7 * 1024 * 1024


def _confirm_body():
    """The confirmation as (fields, proof image bytes or None): a form with an optional `proof` file, or plain JSON when there is no image."""
    if (request.content_length or 0) > MAX_CONFIRM_BYTES:
        raise IncomeError('That image is too large. Use one under 5 MB.', 413, 'proof_too_large')
    if request.files or request.form:
        upload = request.files.get('proof')
        return request.form.to_dict(), (upload.read() if upload and upload.filename else None)
    return request.get_json(silent=True) or {}, None


@income_bp.route('/income/payments/awaiting', methods=['GET'])
@_handled('load the payments waiting for confirmation')
def awaiting():
    _require_admin()
    db, _ = _service()
    return jsonify(PaymentDesk(db).awaiting()), 200


@income_bp.route('/income/payments/status', methods=['GET'])
@_handled('check the payment')
def payment_status():
    _require_admin()
    db, _ = _service()
    return jsonify(PaymentDesk(db).status(request.args.get('source', ''), request.args.get('ref', ''))), 200


@income_bp.route('/income/payments/confirm', methods=['POST'])
@_handled('confirm the payment')
def confirm_payment():
    """An administrator says the money was received. This is the only way an auction or Smart Tag sale becomes income."""
    admin = _require_admin()
    if not rate_limit.allow(f"income-confirm:{admin['account_id']}", 60, 3600):
        raise IncomeError('You are confirming payments very quickly. Wait a few minutes and try again.', 429, 'rate_limited')
    db, _ = _service()
    body, proof_data = _confirm_body()
    result = PaymentDesk(db).confirm(body.get('source'), body.get('source_ref'), body.get('method'), body.get('reference'), body.get('notes'), body.get('expected_amount'), admin['account_id'],
                                     proof_id=body.get('proof_id') or None, proof_data=proof_data)
    entry, receipt = result['entry'], result['receipt']
    _log_admin_action(db, admin, 'Confirm Payment', 'Income', f"{entry.get('description')}: ₱{float(entry.get('amount') or 0):,.2f} by {entry.get('method')}{' with proof' if entry.get('proof_path') else ''}", entry.get('receipt_no'))
    return jsonify({'success': True, 'message': f"Payment confirmed. Receipt {entry.get('receipt_no')} was issued.", 'entry': entry, 'receipt': _public(receipt)}), 201


@income_bp.route('/income/entries/<entry_id>/reverse', methods=['POST'])
@_handled('reverse the payment')
def reverse_payment(entry_id):
    admin = _require_admin(required_level='super_admin')
    db, _ = _service()
    result = PaymentDesk(db).reverse(entry_id, (request.get_json(silent=True) or {}).get('reason'), admin['account_id'])
    _log_admin_action(db, admin, 'Reverse Payment', 'Income', f"Receipt {result['receipt_no']}", result['receipt_no'])
    return jsonify({'success': True, 'message': f"Receipt {result['receipt_no']} was reversed.", 'entry': result['entry']}), 200


@income_bp.route('/income/entries/<entry_id>/receipt', methods=['GET'])
@_handled('load the receipt')
def entry_receipt(entry_id):
    _require_admin()
    db, _ = _service()
    receipt = receipts.receipt_for_payment(db, entry_id)
    if not receipt:
        raise IncomeError('This entry has no payment receipt. Only confirmed auction and Smart Tag payments do.', 404, 'not_found')
    return jsonify({'receipt': _public(receipt)}), 200


@income_bp.route('/income/activity', methods=['GET'])
@_handled('load the income log')
def activity():
    _require_admin()
    db, _ = _service()
    return jsonify({'activity': PaymentDesk(db).activity(request.args.get('limit', 100))}), 200


# ---------------------------------------------------------------------------------------------- payment proofs
@income_bp.route('/income/payments/proofs/<proof_id>/image', methods=['GET'])
@_handled('load the payment receipt image')
def proof_image(proof_id):
    """A ten-minute link to what the payer sent. The storage path never leaves the server."""
    _require_admin()
    db, _ = _service()
    url = PaymentDesk(db).proof_url(proof_id)
    if not url:
        raise IncomeError('This payment receipt image is not available.', 404, 'not_found')
    return jsonify({'url': url}), 200


@income_bp.route('/income/payments/proofs/<proof_id>/reject', methods=['POST'])
@_handled('reject the payment receipt')
def reject_proof(proof_id):
    admin = _require_admin()
    db, _ = _service()
    result = PaymentDesk(db).reject_proof(proof_id, (request.get_json(silent=True) or {}).get('reason'), admin['account_id'])
    _log_admin_action(db, admin, 'Reject Payment Proof', 'Income', f'Proof {str(proof_id)[:8]}', str(proof_id))
    return jsonify({'success': True, 'message': 'The payer was told why and can send another receipt.', **result}), 200


@income_bp.route('/income/entries/<entry_id>/proof', methods=['GET'])
@_handled('load the payment proof')
def entry_proof(entry_id):
    _require_admin()
    db, _ = _service()
    url = PaymentDesk(db).entry_proof_url(entry_id)
    if not url:
        raise IncomeError('No payment receipt image was kept with this payment.', 404, 'not_found')
    return jsonify({'url': url}), 200


# ---------------------------------------------------------------------------------------------- receipts register
@income_bp.route('/income/receipts', methods=['GET'])
@_handled('load the receipts')
def receipts_list():
    """Every receipt the office issued (payments, item handovers, auction collections), searchable, newest first."""
    _require_admin()
    db, _ = _service()
    args = request.args
    return jsonify(receipts.admin_list(db, args.get('kind', ''), args.get('q', ''), args.get('status', ''), args.get('start', ''), args.get('end', ''), args.get('limit', 25), args.get('offset', 0))), 200


@income_bp.route('/income/receipts/<kind>/<record_id>', methods=['GET'])
@_handled('load the receipt')
def receipt_detail(kind, record_id):
    _require_admin()
    db, _ = _service()
    builders = {'payment': receipts.receipt_for_payment, 'claim': receipts.receipt_for_claim, 'auction': receipts.receipt_for_auction}
    if kind not in builders:
        raise IncomeError('Unknown receipt type.', 404, 'not_found')
    receipt = builders[kind](db, record_id)
    if not receipt:
        raise IncomeError('This receipt was not found.', 404, 'not_found')
    return jsonify({'receipt': _public(receipt), 'history': receipts.history(db, receipt['receipt_no'])}), 200


@income_bp.route('/income/receipts/payment/<entry_id>/resend', methods=['POST'])
@_handled('send the receipt')
def receipt_resend(entry_id):
    admin = _require_admin()
    if not rate_limit.allow(f"income-resend:{admin['account_id']}", 30, 3600):
        raise IncomeError('You are sending receipts very quickly. Wait a few minutes and try again.', 429, 'rate_limited')
    db, _ = _service()
    sent = PaymentDesk(db).resend_receipt(entry_id)
    receipt = receipts.receipt_for_payment(db, entry_id) or {}
    _log_admin_action(db, admin, 'Resend Receipt Email', 'Income', f"Receipt {receipt.get('receipt_no')}", receipt.get('receipt_no'), 'success' if sent else 'failed')
    if not sent:
        raise IncomeError('The email could not be sent. Check that the payer has an email address and that email is working (System Control, Monitoring).', 502, 'email_failed')
    return jsonify({'success': True, 'message': 'The receipt was emailed to the payer again.'}), 200


# ---------------------------------------------------------------------------------------------- what payers are told about paying
@income_bp.route('/income/instructions', methods=['GET'])
@_handled('load the payment instructions')
def get_instructions():
    _require_admin()
    db, _ = _service()
    return jsonify({'text': PaymentDesk(db).instructions()}), 200


@income_bp.route('/income/instructions', methods=['PUT'])
@_handled('save the payment instructions')
def set_instructions():
    """Super admins: the text payers see on their auction win or Smart Tag, for example the GCash number and the office hours."""
    admin = _require_admin(required_level='super_admin')
    db, _ = _service()
    text = PaymentDesk(db).set_instructions((request.get_json(silent=True) or {}).get('text'), admin['account_id'])
    _log_admin_action(db, admin, 'Update Payment Instructions', 'Income', f'{len(text)} characters', 'payment-instructions')
    return jsonify({'success': True, 'text': text, 'message': 'Payers will now see these instructions.'}), 200
