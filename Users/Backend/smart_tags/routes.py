"""Smart Tags (user side): the public scan page, registering a tag, managing your tags, and the finder action."""
from functools import wraps
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db, rate_limit
from app.utils.smart_tags import MAX_PHOTO_BYTES, SURRENDER_INSTRUCTIONS, SmartTagService, TagError, TagsUnavailable
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
    return _private({'tags': _service().my_tags(_authenticated_account_id())})


@smart_tags_bp.route('/<tag_id>', methods=['GET'])
@_handled('load the Smart Tag')
def tag_page(tag_id):
    # Throttle lookups per address so the tag space cannot be probed quickly (it is also about 60 bits wide).
    if not rate_limit.allow(f'tag-view:{_client_ip()}', 90, 60):
        raise TagError('Too many lookups. Wait a minute and try again.', 429)
    return _private(_service().public_view(tag_id, _optional_account_id()))


@smart_tags_bp.route('/<tag_id>/found', methods=['POST'])
@_handled('notify the owner')
def found(tag_id):
    ip = _client_ip()
    if not rate_limit.allow(f'tag-found:{ip}', 10, 3600) or not rate_limit.allow(f'tag-found:{ip}:{str(tag_id).upper()}', 3, 3600):
        # The finder still gets the instructions, so a limit never leaves them without guidance.
        return _private({'error': 'You have already sent several notices. The owner has been told.', 'instructions': SURRENDER_INSTRUCTIONS}, 429)
    body = request.get_json(silent=True) or {}
    return _private({'success': True, **_service().report_found(tag_id, body.get('message'), body.get('contact'))})


@smart_tags_bp.route('/<tag_id>/claim', methods=['POST'])
@_handled('register the Smart Tag')
def claim(tag_id):
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'tag-claim:{account_id}', 30, 3600):
        raise TagError('Too many registration attempts. Try again in a while.', 429)
    payload, photo = _payload_and_photo()
    tag = _service().claim(tag_id, account_id, payload, photo)
    return _private({'success': True, 'tag': tag, 'message': 'Your Smart Tag is registered and active.'}, 201)


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
