"""Recycle bin page (super admins only): list what was deleted, restore it, or delete it permanently with an authenticator code."""
from flask import Blueprint, current_app, jsonify, request

from app.utils import get_db
from app.utils.recycle_bin import BinError, RecycleBin, retention_days
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin
from Admin.Backend.shared.authenticator import AuthenticatorError, consume_authenticator_code

recycle_bin_bp = Blueprint('admin_recycle_bin', __name__)
TYPES = {'claim', 'found_item', 'missing_item', 'user', 'auction', 'evidence'}


def _db():
    return get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])


def _guarded(view):
    """Shared error handling: 401 bad token, 403 not a super admin, BinError and AuthenticatorError with their own status."""
    def wrapper(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except BinError as error:
            return jsonify({'error': error.message, 'code': error.code}), error.status
        except AuthenticatorError as error:
            return jsonify({'error': error.message}), error.status
        except ValueError as error:
            return jsonify({'error': str(error)}), 401
        except PermissionError as error:
            return jsonify({'error': str(error)}), 403
        except Exception as error:
            current_app.logger.exception('Recycle bin request failed: %s', error)
            return jsonify({'error': 'The recycle bin request could not be completed'}), 500
    wrapper.__name__ = view.__name__
    return wrapper


@recycle_bin_bp.route('/recycle-bin', methods=['GET'])
@_guarded
def list_bin():
    _require_admin(required_level='super_admin')
    entity_type = request.args.get('type') or None
    if entity_type and entity_type not in TYPES:
        return jsonify({'error': 'Unknown type'}), 400
    items = RecycleBin(_db()).list_items(entity_type, request.args.get('q') or '')
    return jsonify({'items': items, 'retention_days': retention_days()}), 200


@recycle_bin_bp.route('/recycle-bin/<archive_id>/restore', methods=['POST'])
@_guarded
def restore(archive_id):
    admin = _require_admin(required_level='super_admin')
    if (request.get_json(silent=True) or {}).get('confirmation') != 'CONFIRM':
        return jsonify({'error': 'Type CONFIRM to restore this.'}), 400
    db = _db()
    result = RecycleBin(db).restore(archive_id, admin['account_id'])
    _log_admin_action(db, admin, 'Restore From Recycle Bin', 'Recycle Bin', result.get('label'), archive_id)
    skipped = sum((result.get('skipped') or {}).values())
    note = f" {skipped} linked record(s) could not be restored because the people they belonged to are gone." if skipped else ''
    return jsonify({'success': True, 'message': f"Restored: {result.get('label')}.{note}", 'result': result}), 200


@recycle_bin_bp.route('/recycle-bin/<archive_id>/purge', methods=['POST'])
@_guarded
def purge(archive_id):
    admin = _require_admin(required_level='super_admin')
    payload = request.get_json(silent=True) or {}
    if payload.get('confirmation') != 'CONFIRM':
        return jsonify({'error': 'Type CONFIRM to delete this permanently.'}), 400
    db = _db()
    bin_ = RecycleBin(db)
    bin_._get_archived(archive_id)   # a wrong or finished entry is refused before the code is spent
    consume_authenticator_code(db, admin['account_id'], payload.get('authenticator_code'), 'deleting permanently')
    result = bin_.purge(archive_id, admin['account_id'])
    _log_admin_action(db, admin, 'Delete Permanently From Recycle Bin', 'Recycle Bin', result.get('label'), archive_id)
    return jsonify({'success': True, 'message': f"Deleted permanently: {result.get('label')}."}), 200
