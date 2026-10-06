"""Smart Tags (admin "factory"): generate batches of blank tags, review them, print QR codes, deactivate misuse."""
import io
from functools import wraps
from flask import Blueprint, current_app, jsonify, request, send_file
from app.utils import get_db
from app.utils.smart_tags import MAX_BATCH, SmartTagService, TagError, TagsUnavailable, normalize_tag_id, qr_png
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

smart_tags_bp = Blueprint('admin_smart_tags', __name__)


def _service():
    db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
    return db, SmartTagService(db)


def _handled(label):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                return view(*args, **kwargs)
            except TagError as error:
                return jsonify({'error': error.message, **error.extra}), error.status
            except TagsUnavailable as error:
                return jsonify({'error': str(error), 'setup_required': True}), 503
            except ValueError as error:
                return jsonify({'error': str(error)}), 401
            except PermissionError as error:
                return jsonify({'error': str(error)}), 403
            except Exception as error:
                current_app.logger.exception('Admin smart tags %s failed: %s', label, error)
                return jsonify({'error': f'Unable to {label}'}), 500
        return wrapper
    return decorator


@smart_tags_bp.route('/smart-tags', methods=['GET'])
@_handled('load Smart Tags')
def list_tags():
    _require_admin()
    _, service = _service()
    return jsonify({**service.admin_list(request.args.get('status', 'all'), request.args.get('q', '')), 'max_batch': MAX_BATCH}), 200


@smart_tags_bp.route('/smart-tags/batch', methods=['POST'])
@_handled('generate the batch')
def generate_batch():
    admin = _require_admin()
    db, service = _service()
    payload = request.get_json(silent=True) or {}
    batch = service.create_batch(payload.get('count'), payload.get('label'), admin['account_id'], payload.get('tag_type'), payload.get('validity_months'))
    _log_admin_action(db, admin, 'Generate Smart Tag Batch', 'Smart Tags', f"{batch['count']} {batch['tag_type'].upper()} tags ({batch['batch_label']})", batch['batch_id'])
    return jsonify({'success': True, **batch, 'message': f"{batch['count']} blank Smart Tags were generated."}), 201


@smart_tags_bp.route('/smart-tags/batches', methods=['GET'])
@_handled('load the batches')
def list_batches():
    _require_admin()
    _, service = _service()
    return jsonify(service.batches()), 200


@smart_tags_bp.route('/smart-tags/batches/<batch_id>/disable', methods=['POST'])
@_handled('deactivate the batch')
def disable_batch(batch_id):
    admin = _require_admin(required_level='super_admin')
    db, service = _service()
    result = service.set_batch_disabled(batch_id, True, (request.get_json(silent=True) or {}).get('reason'), admin['account_id'])
    _log_admin_action(db, admin, 'Deactivate Smart Tag Batch', 'Smart Tags', f"{result['changed']} tags", result['batch_id'])
    return jsonify({'success': True, **result, 'message': f"{result['changed']} tags in the batch were deactivated."}), 200


@smart_tags_bp.route('/smart-tags/batches/<batch_id>/enable', methods=['POST'])
@_handled('reactivate the batch')
def enable_batch(batch_id):
    admin = _require_admin(required_level='super_admin')
    db, service = _service()
    result = service.set_batch_disabled(batch_id, False, '', admin['account_id'])
    _log_admin_action(db, admin, 'Reactivate Smart Tag Batch', 'Smart Tags', f"{result['changed']} tags", result['batch_id'])
    return jsonify({'success': True, **result, 'message': f"{result['changed']} tags in the batch are active again."}), 200


@smart_tags_bp.route('/smart-tags/<tag_id>/renew', methods=['POST'])
@_handled('renew the Smart Tag')
def renew(tag_id):
    admin = _require_admin()
    db, service = _service()
    row = service.renew(tag_id, (request.get_json(silent=True) or {}).get('months'), admin['account_id'])
    _log_admin_action(db, admin, 'Renew Smart Tag', 'Smart Tags', row.get('item_name') or row['tag_id'], row['tag_id'])
    return jsonify({'success': True, 'valid_until': row.get('valid_until'), 'message': 'The Smart Tag was renewed and the owner was told.'}), 200


@smart_tags_bp.route('/smart-tags/<tag_id>/disable', methods=['POST'])
@_handled('deactivate the Smart Tag')
def disable(tag_id):
    admin = _require_admin(required_level='super_admin')
    db, service = _service()
    row = service.set_disabled(tag_id, True, (request.get_json(silent=True) or {}).get('reason'), admin['account_id'])
    _log_admin_action(db, admin, 'Deactivate Smart Tag', 'Smart Tags', row.get('item_name') or row['tag_id'], row['tag_id'])
    return jsonify({'success': True, 'message': 'The Smart Tag is deactivated. Finders now see nothing and the owner was told.'}), 200


@smart_tags_bp.route('/smart-tags/<tag_id>/enable', methods=['POST'])
@_handled('reactivate the Smart Tag')
def enable(tag_id):
    admin = _require_admin(required_level='super_admin')
    db, service = _service()
    row = service.set_disabled(tag_id, False, '', admin['account_id'])
    _log_admin_action(db, admin, 'Reactivate Smart Tag', 'Smart Tags', row.get('item_name') or row['tag_id'], row['tag_id'])
    return jsonify({'success': True, 'message': 'The Smart Tag is active again.'}), 200


@smart_tags_bp.route('/smart-tags/<tag_id>/photo', methods=['GET'])
@_handled('load the photo')
def photo(tag_id):
    _require_admin()
    _, service = _service()
    return jsonify({'url': service.admin_photo_url(tag_id)}), 200


@smart_tags_bp.route('/smart-tags/<tag_id>/qr', methods=['GET'])
@_handled('create the QR code')
def qr(tag_id):
    _require_admin()
    clean = normalize_tag_id(tag_id)
    if not clean:
        raise TagError('This Smart Tag was not found.', 404)
    _, service = _service()
    service._get(clean)  # 404 for a code that was never generated
    return send_file(io.BytesIO(qr_png(clean)), mimetype='image/png', download_name=f'smart-tag-{clean}.png', max_age=0)
