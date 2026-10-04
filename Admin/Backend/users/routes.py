"""Users page: accounts, access levels, status, deletion and account verification review."""
from datetime import datetime, timezone
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.admin_mfa import matched_totp_step
from app.utils.crypto_service import CryptoService
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

users_bp = Blueprint('admin_users', __name__)


@users_bp.route('/users', methods=['GET'])
def list_users():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'users': db.list_admin_users()}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Admin users listing error: {error}')
        return jsonify({'error': 'Unable to load users'}), 500


@users_bp.route('/account-verifications', methods=['GET'])
def list_account_verifications():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'requests': db.list_account_verification_requests()}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Account verification request listing failed: %s', error)
        return jsonify({'error': 'Unable to load account verification requests'}), 500


@users_bp.route('/account-verifications/<account_id>', methods=['PATCH'])
def review_account_verification(account_id):
    try:
        admin = _require_admin()
        payload = request.get_json(silent=True) or {}
        status = str(payload.get('status') or '').strip().lower()
        role = str(payload.get('user_role') or '').strip()
        review_note = str(payload.get('review_note') or '').strip()
        if status not in {'verified', 'rejected'}:
            return jsonify({'error': 'Choose verified or rejected'}), 400
        if status == 'verified' and role not in {'Student', 'Faculty', 'Others'}:
            return jsonify({'error': 'Choose a valid identity category'}), 400
        if status == 'rejected' and not review_note:
            return jsonify({'error': 'Provide a review note when rejecting a document'}), 400

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        reviewed = db.review_account_verification(
            account_id=account_id,
            status=status,
            reviewed_by=admin['account_id'],
            user_role=role if status == 'verified' else None,
            review_note=review_note,
        )
        display_name = reviewed.get('email') or account_id
        action = 'Verify User Account' if status == 'verified' else 'Reject User Verification'
        _log_admin_action(db, admin, action, 'Account Verification', display_name, account_id)
        notification_created = False
        try:
            if status == 'verified':
                notification_title = 'Account verification approved'
                notification_message = f"Your identity document was approved. Your profile category is now {role}."
                notification_type = 'account_verification_approved'
            else:
                notification_title = 'Verification document needs changes'
                notification_message = f'Your document was not approved. Review note: {review_note}'
                notification_type = 'account_verification_rejection'
            db.create_user_notification(
                user_account_id=account_id,
                title=notification_title,
                message=notification_message,
                notification_type=notification_type,
                link_label='View Profile',
                link_page='profile',
            )
            notification_created = True
        except Exception as notification_error:
            current_app.logger.exception('Verification decision saved but user notification failed for %s: %s', account_id, notification_error)
        return jsonify({
            'success': True,
            'user': reviewed,
            'notification_created': notification_created,
            'message': 'Verification decision saved and the user was notified.' if notification_created else 'Verification decision saved, but the user notification could not be created.',
        }), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except RuntimeError as error:
        return jsonify({'error': str(error)}), 409
    except Exception as error:
        current_app.logger.exception('Account verification review failed for %s: %s', account_id, error)
        return jsonify({'error': 'Unable to review account verification'}), 500


@users_bp.route('/users/<account_id>', methods=['DELETE'])
def delete_user_account(account_id):
    try:
        actor = _require_admin(required_level='super_admin')
        if account_id == actor.get('account_id'):
            return jsonify({'error': 'You cannot delete your own account'}), 403

        payload = request.get_json(silent=True) or {}
        if payload.get('confirmation') != 'CONFIRM':
            return jsonify({'error': 'Type CONFIRM to authorize account deletion'}), 400
        totp_code = str(payload.get('authenticator_code') or '').strip()

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        mfa_record = db.get_admin_mfa(actor['account_id'])
        if not mfa_record or not mfa_record.get('enabled_at'):
            return jsonify({'error': 'Enable Google Authenticator in your Admin Profile before deleting accounts'}), 403

        locked_until = mfa_record.get('locked_until')
        if locked_until:
            parsed_lock = datetime.fromisoformat(str(locked_until).replace('Z', '+00:00'))
            if parsed_lock.tzinfo is None:
                parsed_lock = parsed_lock.replace(tzinfo=timezone.utc)
            if parsed_lock > datetime.now(timezone.utc):
                return jsonify({'error': 'Google Authenticator verification is temporarily locked'}), 423

        secret = CryptoService.decrypt(mfa_record.get('secret_ciphertext'))
        accepted_step = matched_totp_step(secret or '', totp_code)
        if accepted_step is None:
            db.record_admin_mfa_failure(actor['account_id'])
            return jsonify({'error': 'Authenticator code is invalid'}), 401
        if not db.consume_admin_mfa_step(actor['account_id'], accepted_step):
            return jsonify({'error': 'Authenticator code was already used or MFA is locked'}), 401

        deleted = db.delete_admin_user(account_id, actor['account_id'], accepted_step)
        _log_admin_action(db, actor, 'Delete User Account', 'Users', 'Deleted account', None)
        storage_clean = bool(deleted.get('storage_cleanup_complete', False))
        message = (
            'Account and associated data were deleted.' if storage_clean
            else 'Account data was deleted, but some stored files need administrator cleanup.'
        )
        return jsonify({
            'success': True,
            'message': message,
            'deleted_found_items': deleted.get('deleted_found_items', 0),
            'deleted_missing_items': deleted.get('deleted_missing_items', 0),
            'deleted_claims': deleted.get('deleted_claims', 0),
            'storage_cleanup_complete': storage_clean,
            'storage_cleanup_failures': deleted.get('storage_cleanup_failures', []),
        }), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except RuntimeError as error:
        message = str(error)
        if 'not found' in message.lower():
            return jsonify({'error': message}), 404
        if 'last active' in message.lower():
            return jsonify({'error': message}), 409
        if 'superadministrator' in message.lower() or 'authenticator' in message.lower() or 'cannot delete your own' in message.lower():
            return jsonify({'error': message}), 403
        return jsonify({'error': message}), 409
    except Exception as error:
        error_text = str(error).lower()
        if 'last active superadministrator' in error_text:
            return jsonify({'error': 'Cannot delete the last active superadministrator'}), 409
        if 'google authenticator' in error_text or 'super administrator access required' in error_text:
            return jsonify({'error': str(error)}), 403
        current_app.logger.exception('Superadmin account deletion failed for account_id=%s', account_id)
        return jsonify({'error': 'Unable to delete account. No account data was intentionally removed.'}), 500


@users_bp.route('/users/<account_id>/status', methods=['PATCH'])
def update_user_status(account_id):
    try:
        actor = _require_admin()
        payload = request.get_json(silent=True) or {}
        status = str(payload.get('status') or '').strip().lower()
        if status not in {'active', 'suspended'}:
            return jsonify({'error': 'Status must be active or suspended'}), 400

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        target = db.get_user_by_account_id(account_id)
        if not target:
            return jsonify({'error': 'User not found'}), 404
        if account_id == actor.get('account_id'):
            return jsonify({'error': 'You cannot suspend or deactivate your own admin account'}), 403
        target_level = str(target.get('access_level') or '').lower()
        if target_level == 'super_admin' and actor.get('access_level') != 'super_admin':
            return jsonify({'error': 'Only a super administrator can change a super administrator account'}), 403
        updated = db.update_user_status(account_id, status)
        _log_admin_action(db, actor, 'Suspend User' if status == 'suspended' else 'Reactivate User', 'Users', target.get('email') or account_id, account_id)
        return jsonify({'user': updated}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin user status error: %s', error)
        return jsonify({'error': 'Unable to update user status', 'details': str(error)}), 500


@users_bp.route('/users/<account_id>/access-level', methods=['PATCH'])
def update_user_access_level(account_id):
    try:
        actor = _require_admin(required_level='super_admin')
        payload = request.get_json(silent=True) or {}
        access_level = str(payload.get('access_level') or '').strip().lower()
        if access_level not in {'user', 'admin'}:
            return jsonify({'error': 'Access level must be user or admin'}), 400

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        updated = db.set_user_access_level(account_id, access_level, actor['account_id'])
        db.log_user_activity(
            account_id=actor['account_id'],
            user_name=actor.get('email') or 'Super Admin',
            action='Change User Access Level',
            module='Users',
            target_name=updated.get('email') or account_id,
            target_id=account_id,
            result='success',
            metadata={'access_level': access_level},
        )
        return jsonify({'user': updated}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Super admin access update failed for %s: %s', account_id, error)
        return jsonify({'error': 'Unable to update user access level'}), 500
