"""Notifications page, header menu and unread badge: list, unread count, mark one read, mark all read."""
from flask import Blueprint, current_app, jsonify, request
from app.utils import JWTService, get_db

notifications_bp = Blueprint('notifications', __name__)


def _require_auth():
    """Verify JWT token and return user payload"""
    auth_header = request.headers.get('Authorization', '')
    token = JWTService.extract_token_from_header(auth_header)
    payload = JWTService.verify_token(token)
    return payload


@notifications_bp.route('/count/unread', methods=['GET'])
@notifications_bp.route('count/unread', methods=['GET'])
def get_unread_count():
    try:
        payload = _require_auth()
        # Get user_id from token - support both 'account_id' and 'sub' claims
        user_id = payload.get('account_id') or payload.get('sub') or payload.get('user_id')
        if not user_id:
            return jsonify({'error': 'User ID not found in token'}), 401

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        count = db.get_unread_notification_count(user_id)
        return jsonify({'unreadCount': count}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Get unread count error: {error}')
        return jsonify({'error': 'Unable to get unread count'}), 500


@notifications_bp.route('', methods=['GET'])
@notifications_bp.route('/', methods=['GET'])
def get_user_notifications():
    try:
        payload = _require_auth()
        # Get user_id from token - support both 'account_id' and 'sub' claims
        user_id = payload.get('account_id') or payload.get('sub') or payload.get('user_id')
        if not user_id:
            return jsonify({'error': 'User ID not found in token'}), 401

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        limit = request.args.get('limit', 50, type=int)
        notifications = db.get_user_notifications(user_id, limit=limit)
        return jsonify({'notifications': notifications}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Get notifications error: {error}')
        return jsonify({'error': 'Unable to fetch notifications'}), 500


@notifications_bp.route('/<notification_id>/read', methods=['PATCH'])
def mark_notification_read(notification_id):
    try:
        payload = _require_auth()
        # Get user_id from token - support both 'account_id' and 'sub' claims
        user_id = payload.get('account_id') or payload.get('sub') or payload.get('user_id')
        if not user_id:
            return jsonify({'error': 'User ID not found in token'}), 401

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        result = db.mark_notification_as_read(notification_id, user_account_id=user_id)
        return jsonify(result), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        if 'No notification found' in str(error):
            return jsonify({'error': 'That notice was not found.'}), 404
        current_app.logger.exception(f'Mark notification read error: {error}')
        return jsonify({'error': 'Unable to mark notification as read', 'details': str(error)}), 500


@notifications_bp.route('/read-all', methods=['POST', 'PATCH'])
def mark_all_notifications_read():
    """"Mark all as read" in the header menu: only the signed-in person's own unread notices change."""
    try:
        payload = _require_auth()
        user_id = payload.get('account_id') or payload.get('sub') or payload.get('user_id')
        if not user_id:
            return jsonify({'error': 'User ID not found in token'}), 401

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'updated': db.mark_all_notifications_as_read(user_id), 'unreadCount': 0}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.exception(f'Mark all notifications read error: {error}')
        return jsonify({'error': 'Unable to mark the notifications as read'}), 500
