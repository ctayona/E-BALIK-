"""Found Items page: list, create, edit and delete found reports (the history of one item is read by the Items in custody tab)."""
import base64
import binascii
import re
import uuid
from datetime import datetime, timezone
from flask import Blueprint, current_app, jsonify, request
from app.utils.recycle_bin import BinError, retention_days
from app.utils import get_db
from app.utils import custody_log
from app.utils.custody import load_overview
from app.utils.smart_tags import SmartTagService, TagError, normalize_tag_id
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

found_items_bp = Blueprint('admin_found_items', __name__)


def _store_admin_item_photo(db, value, bucket, account_id, item_date):
    if not isinstance(value, str) or not value.startswith('data:'):
        return value
    match = re.fullmatch(r'data:(image/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)', value)
    if not match:
        raise ValueError('Use a valid PNG or JPG item photo')
    content_type, encoded = match.groups()
    try:
        file_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError('Item photo data is invalid') from error
    if len(file_bytes) > 10 * 1024 * 1024:
        raise ValueError('Item photos must be 10 MB or smaller')
    extension = 'jpg' if content_type == 'image/jpeg' else 'png'
    path = f'{account_id}/{item_date}/{uuid.uuid4().hex}.{extension}'
    db.client.storage.from_(bucket).upload(path, file_bytes, {'content-type': content_type, 'upsert': 'false'})
    public_url = db.client.storage.from_(bucket).get_public_url(path)
    if isinstance(public_url, dict):
        return public_url.get('publicUrl') or public_url.get('publicURL') or public_url.get('url')
    return public_url


@found_items_bp.route('/found-items', methods=['GET'])
def list_found_items():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'items': db.list_admin_found_items()}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Admin found items list error: {error}')
        return jsonify({'error': 'Unable to load found items'}), 500


@found_items_bp.route('/found-items/<reference>/history', methods=['GET'])
def item_history(reference):
    """The handover log of one item: every step from being turned over to being released, sold or returned to custody."""
    try:
        _require_admin()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        history = custody_log.timeline(db.client, reference)
        if not history:
            return jsonify({'error': 'That found item was not found.'}), 404
        return jsonify(history), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Custody history error: {error}')
        return jsonify({'error': 'Unable to load the item history'}), 500


@found_items_bp.route('/found-items/custody', methods=['GET'])
def custody_overview():
    """Items the office is still holding, with what is happening to each (claims, auctions, who received it)."""
    try:
        _require_admin()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        return jsonify(load_overview(db.client)), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Custody overview error: {error}')
        return jsonify({'error': 'Unable to load the items in custody'}), 500


@found_items_bp.route('/found-items', methods=['POST'])
def create_found_item():
    try:
        admin = _require_admin()
        payload = request.get_json(silent=True) or {}
        item_name = str(payload.get('item') or '').strip()
        category = str(payload.get('category') or '').strip()
        location = str(payload.get('locationFound') or '').strip()
        date_found = str(payload.get('dateFound') or '').strip()
        storage = str(payload.get('storage') or '').strip()
        if not all((item_name, category, location, date_found, storage)):
            return jsonify({'error': 'Item, category, location, date found, and storage are required'}), 400
        datetime.strptime(date_found, '%Y-%m-%d')
        tag_code = str(payload.get('smartTagCode') or '').strip()
        tag_id = None
        if tag_code:
            tag_id = normalize_tag_id(tag_code)
            if not tag_id:
                return jsonify({'error': 'That is not a valid Smart Tag code.'}), 400

        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if tag_id:
            try:
                SmartTagService(db)._refresh(SmartTagService(db)._get(tag_id))   # fail before anything is saved when the tag does not exist
            except TagError as error:
                return jsonify({'error': error.message}), error.status
        profile = db.get_user_by_account_id(admin['account_id']) or {}
        weekday_code = str(datetime.strptime(date_found, '%Y-%m-%d').weekday() + 1)
        reference = db.next_fpost_id(date_found, weekday_code)
        photo_url = _store_admin_item_photo(db, payload.get('photo'), 'found-item-images', admin['account_id'], date_found)
        created = db.create_found_item({
            'account_id': admin['account_id'],
            'fpost_id': reference,
            'reporter_account_id': admin['account_id'],
            'reporter_email': profile.get('email'),
            'reporter_campus_id': profile.get('campus_id'),
            'reporter_name': f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip(),
            'item_name': item_name,
            'category': category,
            'description': str(payload.get('description') or '').strip(),
            'location': location,
            'found_date': date_found,
            'image_url': photo_url or None,
            'turnover_location': storage,
            'guard_name_or_id': f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip() or 'Admin',
            'custody_status': 'turned_over',
            'status': 'unclaimed',
            'smart_tag_id': tag_id,
        })
        actor = f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip()
        custody_log.record(db.client, created.get('item_id'), 'registered', admin['account_id'], actor, f'Registered at {storage}.')
        tag_notified = False
        if tag_id:
            try:
                SmartTagService(db).link_found_item(tag_id, reference, item_name, created.get('item_id'))
                custody_log.record(db.client, created.get('item_id'), 'tag_matched', admin['account_id'], actor, f'Matched to Smart Tag {tag_id}; its owner was told.')
                tag_notified = True
            except TagError as error:
                current_app.logger.warning('Smart Tag %s was not linked to %s: %s', tag_id, reference, error.message)
        _log_admin_action(db, admin, 'Create Found Item', 'Found Items', item_name, reference)
        message = f'Found item {reference} was registered.'
        if tag_id:
            message += ' The Smart Tag owner was told it is here and can claim it.' if tag_notified else ' The Smart Tag owner could not be told because that tag is not active.'
        return jsonify({'success': True, 'reference': reference, 'item': created, 'smart_tag_owner_notified': tag_notified, 'message': message}), 201
    except BinError as error:
        return jsonify({'error': error.message, 'code': error.code}), error.status
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin found item creation failed: %s', error)
        return jsonify({'error': 'Unable to create found item'}), 500


@found_items_bp.route('/found-items/<item_reference>', methods=['PUT', 'DELETE'])
def manage_found_item(item_reference):
    try:
        admin = _require_admin(required_level='super_admin' if request.method == 'DELETE' else 'admin')
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if request.method == 'DELETE':
            if not db.delete_admin_found_item(item_reference, admin['account_id']):
                return jsonify({'error': 'Found item not found'}), 404
            _log_admin_action(db, admin, 'Delete Found Item', 'Found Items', item_reference, item_reference)
            return jsonify({'success': True, 'reference': item_reference, 'message': 'Moved to the Recycle bin. A super admin can restore it for the next %d days.' % retention_days()}), 200

        payload = request.get_json(silent=True) or {}
        if str(payload.get('status') or '').strip().lower() == 'returned':
            return jsonify({
                'error': 'Record in-person collection from the approved claim so linked reports are closed together.'
            }), 409
        if isinstance(payload.get('photo'), str) and payload['photo'].startswith('data:'):
            photo_date = str(payload.get('dateFound') or datetime.now(timezone.utc).date().isoformat())
            payload['photo'] = _store_admin_item_photo(db, payload['photo'], 'found-item-images', admin['account_id'], photo_date)
        updated = db.update_admin_found_item(item_reference, payload)
        if not updated:
            return jsonify({'error': 'Found item not found'}), 404
        _log_admin_action(db, admin, 'Update Found Item', 'Found Items', updated.get('item_name') or item_reference, item_reference)
        return jsonify({'success': True, 'item': updated}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin found item update failed for %s: %s', item_reference, error)
        return jsonify({'error': 'Unable to update found item'}), 500
