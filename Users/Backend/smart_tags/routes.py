"""Smart Tags (user side): the public scan page, registering a tag, managing your tags, and the finder action."""
from functools import wraps
import io
from flask import Blueprint, current_app, jsonify, request, send_file
from app.utils import get_db, rate_limit
from app.utils.smart_tags import MAX_PHOTO_BYTES, SURRENDER_INSTRUCTIONS, SmartTagService, TagError, TagsUnavailable
from app.utils.nfc_tags import prepare_nfc
from app.utils import tag_recovery, tag_scans
from Users.Backend.shared.request_auth import _authenticated_account_id

smart_tags_bp = Blueprint('user_smart_tags', __name__)


def _service():
    return SmartTagService(get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY']))


def _optional_account_id():
    """A signed-in viewer is recognised (to show "this is your tag"), but the scan page works for anyone."""
    try:
        return _authenticated_account_id()
    except Exception:
        return None


def _payload_and_photo():
    """Registration arrives as multipart (fields plus the live `photo`). The photo is read with a hard size cap."""
    if request.mimetype == 'multipart/form-data':
        upload = request.files.get('photo')
        photo = {'data': upload.read(MAX_PHOTO_BYTES + 1), 'mimetype': upload.mimetype} if upload and upload.filename else None
        return request.form.to_dict(), photo
    return (request.get_json(silent=True) or {}), None


def _client_ip() -> str:
    """The address the proxy saw. Render appends the real client last, so the last entry cannot be spoofed by the caller."""
    forwarded = request.headers.get('X-Forwarded-For', '')
    return (forwarded.split(',')[-1].strip() if forwarded else '') or request.remote_addr or 'unknown'


def _private(response, status=200):
    """Tag answers can name a person, so they must not be cached or indexed."""
    reply = jsonify(response)
    reply.status_code = status
    reply.headers['Cache-Control'] = 'no-store'
    reply.headers['X-Robots-Tag'] = 'noindex, nofollow'
    return reply


def _handled(label):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                return view(*args, **kwargs)
            except TagError as error:
                return _private({'error': error.message, **error.extra}, error.status)
            except TagsUnavailable as error:
                return _private({'error': str(error), 'setup_required': True}, 503)
            except ValueError as error:
                return _private({'error': str(error)}, 401)
            except Exception as error:
                current_app.logger.exception('Smart tags %s failed: %s', label, error)
                return _private({'error': f'Unable to {label}'}, 500)
        return wrapper
    return decorator


@smart_tags_bp.route('/mine', methods=['GET'])
@_handled('load your Smart Tags')
def my_tags():
    owner = _authenticated_account_id()
    service = _service()
    tags = service.my_tags(owner)
    if tags and tag_recovery.enabled(service.client):
        tags = [dict(tag, recovery=True) for tag in tags]
    return _private({'tags': tags})


@smart_tags_bp.get('/venues')
@_handled('load campus venues')
def campus_venues():
    from app.utils.campus_catalogue import available
    return jsonify(venues=available(_service().client))


@smart_tags_bp.route('/contacts', methods=['GET'])
@_handled('load your contact methods')
def my_contacts():
    """The signed-in owner's saved contact methods (Messenger, Facebook, ...). Never shown to anyone else except through a tag the owner chose."""
    account_id = _authenticated_account_id()
    service = _service()
    return _private({'contacts': service.get_contacts(account_id), 'settings': service.get_settings(account_id)})


@smart_tags_bp.route('/contacts', methods=['PUT'])
@_handled('save your contact methods')
def save_contacts():
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'tag-contacts:{account_id}', 30, 3600):
        raise TagError('Too many changes. Try again in a while.', 429)
    body = request.get_json(silent=True) or {}
    service = _service()
    contacts = service.save_contacts(account_id, body, body.get('settings') if isinstance(body.get('settings'), dict) else None)
    return _private({'success': True, 'contacts': contacts, 'settings': service.get_settings(account_id)})


@smart_tags_bp.route('/<tag_id>/qr', methods=['GET'])
@_handled('load the QR code')
def my_tag_qr(tag_id):
    """The QR image of one of your own tags (for printing a replacement sticker). Owner only; never cached."""
    png = _service().owner_qr(tag_id, _authenticated_account_id())
    reply = send_file(io.BytesIO(png), mimetype='image/png', max_age=0)
    reply.headers['Cache-Control'] = 'no-store'
    return reply


@smart_tags_bp.route('/<tag_id>/nfc', methods=['POST'])
@_handled('prepare your NFC card')
def nfc_payload(tag_id):
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'tag-nfc:{account_id}', 30, 60):
        raise TagError('Too many requests. Wait a minute and try again.', 429)
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict) or type(body.get('offline_contact', False)) is not bool:
        raise TagError('Choose whether to include offline contact details.')
    return _private(prepare_nfc(_service(), tag_id, account_id=account_id, offline_contact=body.get('offline_contact', False)))


@smart_tags_bp.route('/<tag_id>', methods=['GET'])
@_handled('load the Smart Tag')
def tag_page(tag_id):
    # Throttle lookups per address so the tag space cannot be probed quickly (it is also about 60 bits wide).
    if not rate_limit.allow(f'tag-view:{_client_ip()}', 90, 60):
        raise TagError('Too many lookups. Wait a minute and try again.', 429)
    service = _service()
    result = service.public_view(tag_id, _optional_account_id())
    try:
        result['scan_logging'] = tag_scans.enabled(service.client)
    except Exception:
        # Optional logging must not block the owner's basic recovery information.
        result['scan_logging'] = False
    if result.get('status') in ('active','lost') and tag_recovery.enabled(service.client):
        result['recovery'] = True
    return _private(result)


@smart_tags_bp.post('/<tag_id>/scan')
@_handled('record this page visit')
def record_scan(tag_id):
    if not rate_limit.allow(f'tag-scan:{_client_ip()}',60,60):
        raise TagError('Too many visits; basic recovery remains available.',429)
    return _private(tag_scans.command(_service(),tag_id,request.get_json(silent=True),'record'))


@smart_tags_bp.post('/<tag_id>/scan/<action>')
@_handled('update scan location')
def share_scan(tag_id,action):
    if action not in ('share','withdraw'):
        raise TagError('Invalid scan action',404)
    if not rate_limit.allow(f'tag-scan-share:{_client_ip()}',30,60):
        raise TagError('Too many requests; try again shortly.',429)
    return _private(tag_scans.command(_service(),tag_id,request.get_json(silent=True),action))


@smart_tags_bp.get('/<tag_id>/scans')
@_handled('load shared scan locations')
def owner_scans(tag_id):
    return _private(tag_scans.list_scans(_service(),tag=tag_id,owner=_authenticated_account_id()))


@smart_tags_bp.route('/<tag_id>/found', methods=['POST'])
@_handled('notify the owner')
def found(tag_id):
    ip = _client_ip()
    if not rate_limit.allow(f'tag-found:{ip}', 10, 3600) or not rate_limit.allow(f'tag-found:{ip}:{str(tag_id).upper()}', 3, 3600):
        # The finder still gets the instructions, so a limit never leaves them without guidance.
        return _private({'error': 'Too many requests. Please follow the handover instructions.', 'instructions': SURRENDER_INSTRUCTIONS}, 429)
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        raise TagError('Invalid finder report.')
    if set(body) - {'message','contact'}:
        return _private({'success': True, **tag_recovery.submit(_service(),tag_id,body)})
    return _private({'success': True, **_service().report_found(tag_id, body.get('message'), body.get('contact'))})


@smart_tags_bp.get('/<tag_id>/recovery')
@_handled('load recovery activity')
def recovery_history(tag_id):
    owner = _authenticated_account_id()
    offset = request.args.get('offset', '0')
    if not offset.isascii() or not offset.isdigit() or len(offset) > 6:
        raise TagError('Invalid history page.')
    return _private({'reports': tag_recovery.history(_service(), tag_id, owner, int(offset))})


@smart_tags_bp.post('/<tag_id>/recovery/<uuid:report_id>/flag')
@_handled('flag recovery report')
def flag_report(tag_id,report_id):
    owner = _authenticated_account_id()
    table,tag = tag_recovery.owned(_service(),tag_id,owner)
    rows = table.update({'review':'flagged'}).eq('tag_id',tag).eq('owner_id',owner).eq('report_id',str(report_id)).eq('review','clear').execute().data
    if not rows:
        raise TagError('Report unavailable for review.',409)
    current_app.logger.info('Owner flagged recovery report owner=%s report=%s', owner, report_id)
    return _private({'success':True})


@smart_tags_bp.route('/<tag_id>/claim', methods=['POST'])
@_handled('register the Smart Tag')
def claim(tag_id):
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'tag-claim:{account_id}', 30, 3600):
        raise TagError('Too many registration attempts. Try again in a while.', 429)
    payload, photo = _payload_and_photo()
    tag = _service().claim(tag_id, account_id, payload, photo)
    price = float(tag.get('price') or 0)
    pay = f' and ₱{price:,.2f} for the tag' if price > 0 and not tag.get('paid') else ''
    return _private({'success': True, 'tag': tag, 'message': f'Your Smart Tag was submitted. Bring the item{pay} to the Lost and Found Office so staff can approve it.'}, 201)


@smart_tags_bp.route('/<tag_id>/photo', methods=['POST'])
@_handled('save the photo')
def photo(tag_id):
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'tag-photo:{account_id}', 30, 3600):
        raise TagError('Too many photo uploads. Try again in a while.', 429)
    _, picture = _payload_and_photo()
    return _private({'success': True, 'tag': _service().set_photo(tag_id, account_id, picture)})


@smart_tags_bp.route('/<tag_id>', methods=['PATCH'])
@_handled('update the Smart Tag')
def update(tag_id):
    account_id = _authenticated_account_id()
    return _private({'success': True, 'tag': _service().update(tag_id, account_id, request.get_json(silent=True) or {})})
