"""Lost Items page: list, create, edit and delete missing reports."""
from datetime import datetime
from flask import Blueprint, current_app, jsonify, request
from app.utils.recycle_bin import BinError, retention_days
from app.utils import get_db
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

lost_items_bp = Blueprint('admin_lost_items', __name__)


@lost_items_bp.route('/lost-items', methods=['GET'])
def list_lost_items():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'items': db.list_admin_missing_items()}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Admin lost items list error: {error}')
        return jsonify({'error': 'Unable to load lost items'}), 500


@lost_items_bp.route('/lost-items', methods=['POST'])
def create_lost_item():
    try:
        admin = _require_admin()
        payload = request.get_json(silent=True) or {}
        item_name = str(payload.get('item') or '').strip()
        category = str(payload.get('category') or '').strip()
        location = str(payload.get('location') or '').strip()
        date_lost = str(payload.get('dateLost') or '').strip()
        if not all((item_name, category, location, date_lost)):
            return jsonify({'error': 'Item, category, location, and date lost are required'}), 400
        datetime.strptime(date_lost, '%Y-%m-%d')

        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        profile = db.get_user_by_account_id(admin['account_id']) or {}
        weekday_code = str(datetime.strptime(date_lost, '%Y-%m-%d').weekday() + 1)
        reference = db.next_mpost_id(date_lost, weekday_code)
        created = db.create_missing_item({
            'account_id': admin['account_id'],
            'mpost_id': reference,
            'reporter_account_id': admin['account_id'],
            'reporter_email': profile.get('email'),
            'reporter_campus_id': str(payload.get('studentId') or profile.get('campus_id') or ''),
            'reporter_name': str(payload.get('reportedBy') or '').strip() or f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip(),
            'item_name': item_name,
            'category': category,
            'description': str(payload.get('description') or '').strip(),
            'last_location': location,
            'last_seen_date': date_lost,
            'status': 'missing',
        })
        _log_admin_action(db, admin, 'Create Lost Item', 'Lost Items', item_name, reference)
        return jsonify({'success': True, 'reference': reference, 'item': created}), 201
    except BinError as error:
        return jsonify({'error': error.message, 'code': error.code}), error.status
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin lost item creation failed: %s', error)
        return jsonify({'error': 'Unable to create lost item'}), 500


@lost_items_bp.route('/lost-items/<item_reference>', methods=['PUT', 'DELETE'])
def manage_lost_item(item_reference):
    try:
        admin = _require_admin(required_level='super_admin' if request.method == 'DELETE' else 'admin')
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if request.method == 'DELETE':
            if not db.delete_admin_missing_item(item_reference, admin['account_id']):
                return jsonify({'error': 'Lost item not found'}), 404
            _log_admin_action(db, admin, 'Delete Lost Item', 'Lost Items', item_reference, item_reference)
            return jsonify({'success': True, 'reference': item_reference, 'message': 'Moved to the Recycle bin. A super admin can restore it for the next %d days.' % retention_days()}), 200

        payload = request.get_json(silent=True) or {}
        updated = db.update_admin_missing_item(item_reference, payload)
        if not updated:
            return jsonify({'error': 'Lost item not found'}), 404
        _log_admin_action(db, admin, 'Update Lost Item', 'Lost Items', updated.get('item_name') or item_reference, item_reference)
        return jsonify({'success': True, 'item': updated}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin lost item update failed for %s: %s', item_reference, error)
        return jsonify({'error': 'Unable to update lost item'}), 500
