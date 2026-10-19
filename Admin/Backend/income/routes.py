"""Income page: what the Auction Hall and Smart Tags earned, what is still owed, and the ledger behind every number.

Administrators can read it; only super administrators add manual entries (refunds, corrections, other payments).
"""
from functools import wraps
from flask import Blueprint, Response, current_app, jsonify, request
from app.utils import get_db
from app.utils.income import IncomeError, IncomeService, IncomeUnavailable
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
