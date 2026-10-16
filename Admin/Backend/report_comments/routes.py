"""Moderation of comments on missing and found reports: hide a comment (or restore it). Hidden comments are kept but never shown."""
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.report_social import ReportSocial, SocialError
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

report_comments_bp = Blueprint('admin_report_comments', __name__)


@report_comments_bp.route('/report-comments/<comment_id>', methods=['PATCH'])
def moderate_comment(comment_id):
    try:
        admin = _require_admin()
        hidden = (request.get_json(silent=True) or {}).get('hidden', True) is not False
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if not ReportSocial(db).hide_comment(comment_id, admin['account_id'], hidden):
            return jsonify({'error': 'That comment was not found.'}), 404
        _log_admin_action(db, admin, 'Hide Report Comment' if hidden else 'Restore Report Comment', 'Reports', comment_id, comment_id)
        return jsonify({'success': True, 'message': 'The comment is hidden.' if hidden else 'The comment is visible again.'}), 200
    except SocialError as error:
        return jsonify({'error': error.message, 'code': error.code}), error.status
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Comment moderation failed: %s', error)
        return jsonify({'error': 'Unable to update the comment'}), 500
