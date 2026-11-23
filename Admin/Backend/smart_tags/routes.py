"""Smart Tags (admin "factory"): generate batches of blank tags, review them, print QR codes, deactivate misuse."""
import io
from functools import wraps
from flask import Blueprint, current_app, jsonify, request, send_file
from app.utils import campus_catalogue, tag_recovery, get_db
from app.utils.smart_tags import MAX_BATCH, MAX_PHOTO_BYTES, SmartTagService, TagError, TagsUnavailable, normalize_tag_id, qr_png
from app.utils.nfc_tags import prepare_nfc
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
    return jsonify({**service.admin_list(request.args.get('status', 'all'), request.args.get('q', ''), request.args.get('type', 'all')), 'max_batch': MAX_BATCH, 'recovery': tag_recovery.enabled(service.client), 'venue_management': campus_catalogue.ready(service.client)}), 200


@smart_tags_bp.route('/smart-tags/<tag_id>/nfc', methods=['GET'])
@_handled('prepare the NFC card')
def nfc_payload(tag_id):
    _require_admin()
    _, service = _service()
    reply = jsonify(prepare_nfc(service, tag_id))
    reply.headers['Cache-Control'] = 'no-store'
    return reply


@smart_tags_bp.route('/smart-tags/batch', methods=['POST'])
@_handled('generate the batch')
def generate_batch():
    admin = _require_admin()
    db, service = _service()
    payload = request.get_json(silent=True) or {}
    batch = service.create_batch(payload.get('count'), payload.get('label'), admin['account_id'], payload.get('tag_type'), payload.get('validity_months'), payload.get('price'))
    price_note = f" at ₱{batch['price']:,.2f} each" if batch.get('price') else ' (free)'
    _log_admin_action(db, admin, 'Generate Smart Tag Batch', 'Smart Tags', f"{batch['count']} {batch['tag_type'].upper()} tags ({batch['batch_label']}){price_note}", batch['batch_id'])
    return jsonify({'success': True, **batch, 'message': f"{batch['count']} blank Smart Tags were generated."}), 201


@smart_tags_bp.route('/smart-tags/batches', methods=['GET'])
@_handled('load the batches')
def list_batches():
    _require_admin()
    _, service = _service()
    return jsonify(service.batches()), 200


@smart_tags_bp.route('/smart-tags/batches/<batch_id>/price', methods=['POST'])
@_handled('change the batch price')
def batch_price(batch_id):
    admin = _require_admin(required_level='super_admin')
    db, service = _service()
    result = service.set_batch_price(batch_id, (request.get_json(silent=True) or {}).get('price'), admin['account_id'])
    _log_admin_action(db, admin, 'Set Smart Tag Price', 'Smart Tags', f"₱{result['price']:,.2f} for {result['updated']} unsold tags", batch_id)
    return jsonify({'success': True, **result, 'message': f"{result['updated']} unsold tags now cost ₱{result['price']:,.2f}."}), 200


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
    return jsonify(service.admin_photos(tag_id)), 200


@smart_tags_bp.route('/smart-tags/<tag_id>/approve', methods=['POST'])
@_handled('approve the Smart Tag')
def approve(tag_id):
    admin = _require_admin()
    db, service = _service()
    row = service.approve(tag_id, admin['account_id'])
    _log_admin_action(db, admin, 'Approve Smart Tag', 'Smart Tags', row.get('item_name') or row['tag_id'], row['tag_id'])
    return jsonify({'success': True, 'message': 'The Smart Tag is approved and active. The owner was told.'}), 200


@smart_tags_bp.route('/smart-tags/<tag_id>/reject', methods=['POST'])
@_handled('reject the Smart Tag')
def reject(tag_id):
    admin = _require_admin()
    db, service = _service()
    row = service.reject(tag_id, (request.get_json(silent=True) or {}).get('reason'), admin['account_id'])
    _log_admin_action(db, admin, 'Reject Smart Tag', 'Smart Tags', row.get('item_name') or row['tag_id'], row['tag_id'])
    return jsonify({'success': True, 'message': 'The Smart Tag was not approved. The owner was told why.'}), 200


@smart_tags_bp.route('/smart-tags/<tag_id>', methods=['PATCH'])
@_handled('update the Smart Tag')
def update_tag(tag_id):
    """Staff edit: every field and the photo, as JSON or multipart. Never changes the approval state."""
    admin = _require_admin()
    db, service = _service()
    picture = None
    if request.mimetype == 'multipart/form-data':
        payload = request.form.to_dict()
        upload = request.files.get('photo')
        if upload and upload.filename:
            picture = {'data': upload.read(MAX_PHOTO_BYTES + 1), 'mimetype': upload.mimetype}
    else:
        payload = request.get_json(silent=True) or {}
    row = service.admin_update(tag_id, payload, picture, admin['account_id'])
    _log_admin_action(db, admin, 'Edit Smart Tag', 'Smart Tags', row.get('item_name') or row['tag_id'], row['tag_id'])
    return jsonify({'success': True, 'message': 'The Smart Tag was updated.'}), 200


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


@smart_tags_bp.route('/smart-tags/<tag_id>', methods=['DELETE'])
@_handled('delete the Smart Tag')
def delete_tag(tag_id):
    """Super admins: delete a blank (never registered) or deactivated tag. Recorded income is kept."""
    admin = _require_admin(required_level='super_admin')
    db, service = _service()
    result = service.delete_tag(tag_id, admin['account_id'])
    _log_admin_action(db, admin, 'Delete Smart Tag', 'Smart Tags', result['tag_id'], result['tag_id'])
    return jsonify({'success': True, **result, 'message': f"Smart Tag {result['tag_id']} was deleted."}), 200


@smart_tags_bp.route('/smart-tags/batches/<batch_id>', methods=['DELETE'])
@_handled('delete the batch')
def delete_batch(batch_id):
    """Super admins: delete the unused and deactivated tags of a batch. Tags still in use stay."""
    admin = _require_admin(required_level='super_admin')
    db, service = _service()
    result = service.delete_batch(batch_id, admin['account_id'])
    _log_admin_action(db, admin, 'Delete Smart Tag Batch', 'Smart Tags', f"{result['deleted']} tags deleted, {result['kept']} kept", result['batch_id'])
    kept = f" {result['kept']} tags still in use were kept." if result['kept'] else ''
    return jsonify({'success': True, **result, 'message': f"{result['deleted']} unused or deactivated tags were deleted.{kept}"}), 200


@smart_tags_bp.get('/smart-tags/recovery/flagged')
@_handled('review flagged reports')
def flagged_reports():
    actor = _require_admin()
    db, service = _service()
    tag_recovery.require(service.client)
    rows = service.client.table('tag_recovery_reports').select('report_id,tag_id,created_at,note').eq('review','flagged').order('created_at').limit(50).execute().data
    _log_admin_action(db, actor, 'Read flagged report queue', 'Smart Tags', 'Flagged reports', None)
    return jsonify(reports=rows), 200, {'Cache-Control': 'no-store'}


@smart_tags_bp.post('/smart-tags/recovery/<uuid:report_id>/review')
@_handled('resolve flagged report')
def resolve_report(report_id):
    actor = _require_admin()
    db, service = _service()
    tag_recovery.require(service.client)
    rows = service.client.table('tag_recovery_reports').update({'review':'reviewed'}).eq('report_id',str(report_id)).eq('review','flagged').execute().data
    if not rows:
        raise TagError('Report is no longer awaiting review.',409)
    _log_admin_action(db, actor, 'Review flagged report', 'Smart Tags', rows[0]['tag_id'], str(report_id))
    return jsonify(success=True)


@smart_tags_bp.route('/smart-tags/venues', methods=['GET', 'POST'])
@_handled('manage campus venue availability')
def venue_management():
    actor = _require_admin('super_admin')
    db, service = _service()
    if not campus_catalogue.ready(service.client):
        raise TagError('Campus venue management is disabled.', 503)
    table = service.client.table('campus_venues')
    if request.method == 'GET':
        editable = campus_catalogue.management_ready(service.client)
        rows = table.select('label,active,version' if editable else 'label,active').order('label').execute().data
        return jsonify(venues=rows, editable=editable), 200, {'Cache-Control': 'no-store'}
    body = request.get_json(silent=True)
    if not campus_catalogue.management_ready(service.client):
        raise TagError('Apply the venue management migration before editing locations.', 503)
    if not isinstance(body, dict) or set(body) != {'action', 'label', 'target', 'active', 'version'}:
        raise TagError('Supply the venue editing fields.')
    if body['action'] not in ('create', 'rename', 'availability') or any(not isinstance(body[k],str) for k in ('label','target')):
        raise TagError('Choose a valid action and location.')
    if type(body['active']) is not bool or type(body['version']) is not int or body['version']<0:
        raise TagError('Refresh and choose the current venue version.')
    result = service.client.rpc('campus_venue_manage', dict(
        p_actor=actor['account_id'], p_action=body['action'], p_label=body['label'],
        p_target=body['target'], p_active=body['active'], p_version=body['version'])).execute().data
    if not isinstance(result,dict) or not result.get('ok'):
        raise TagError(result.get('error','Unable to edit venue.') if isinstance(result,dict) else 'Unable to edit venue.',409)
    return jsonify(success=True, label=result['label'])
