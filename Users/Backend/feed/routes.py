"""User home feed: open reports as posts, with comments and "helpful" reactions."""
from functools import wraps
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db, rate_limit
from app.utils.report_social import FEED_PAGE, ReportSocial, SocialError
from Users.Backend.shared.request_auth import _authenticated_account_id

feed_bp = Blueprint('user_feed', __name__)


def _social() -> ReportSocial:
    return ReportSocial(get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY']))


def _too_many(message='You are doing that too fast. Wait a moment and try again.', retry_after=30):
    response = jsonify({'error': message, 'code': 'rate_limited', 'retry_after': retry_after})
    response.status_code = 429
    response.headers['Retry-After'] = str(retry_after)
    return response


def _handled(label):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            try:
                return view(*args, **kwargs)
            except SocialError as error:
                return jsonify({'error': error.message, 'code': error.code}), error.status
            except ValueError as error:
                return jsonify({'error': str(error)}), 401
            except Exception as error:
                current_app.logger.exception('Feed %s failed: %s', label, error)
                return jsonify({'error': f'Unable to {label}'}), 500
        return wrapper
    return decorator


@feed_bp.route('', methods=['GET'])
@_handled('load the feed')
def feed():
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'feed-read:{account_id}', 120, 60):
        return _too_many()
    limit = request.args.get('limit', FEED_PAGE, type=int)
    return jsonify(_social().feed(account_id, request.args.get('kind', 'all'), limit, request.args.get('before') or None)), 200


@feed_bp.route('/<kind>/<reference>', methods=['GET'])
@_handled('load the report')
def one_post(kind, reference):
    """A single open report, so a shared link can open it even when it is not on the first page of the feed."""
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'feed-read:{account_id}', 120, 60):
        return _too_many()
    return jsonify(_social().post(kind, reference, account_id)), 200


@feed_bp.route('/<kind>/<reference>/comments', methods=['GET'])
@_handled('load the comments')
def comments(kind, reference):
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'feed-read:{account_id}', 120, 60):
        return _too_many()
    return jsonify(_social().comments(kind, reference, account_id)), 200


@feed_bp.route('/<kind>/<reference>/comments', methods=['POST'])
@_handled('post the comment')
def add_comment(kind, reference):
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'feed-comment-min:{account_id}', 5, 60):
        return _too_many('You are commenting too fast. Wait a minute and try again.', 60)
    if not rate_limit.allow(f'feed-comment-hour:{account_id}', 40, 3600):
        return _too_many('You have posted a lot of comments this hour. Please try again later.', 900)
    return jsonify(_social().add_comment(kind, reference, account_id, (request.get_json(silent=True) or {}).get('body'))), 201


@feed_bp.route('/comments/<comment_id>', methods=['DELETE'])
@_handled('delete the comment')
def delete_comment(comment_id):
    account_id = _authenticated_account_id()
    if not _social().delete_comment(comment_id, account_id):
        return jsonify({'error': 'That comment was not found, or it is not yours.'}), 404
    return jsonify({'success': True}), 200


@feed_bp.route('/<kind>/<reference>/reaction', methods=['PUT', 'DELETE'])
@_handled('save your reaction')
def reaction(kind, reference):
    account_id = _authenticated_account_id()
    if not rate_limit.allow(f'feed-react:{account_id}', 40, 60):
        return _too_many()
    return jsonify(_social().set_reaction(kind, reference, account_id, request.method == 'PUT')), 200
