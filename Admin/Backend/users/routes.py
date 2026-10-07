"""Users page: accounts, access levels, status, deletion and account verification review."""
import uuid
from datetime import datetime, timezone
from email_validator import EmailNotValidError, validate_email
from flask import Blueprint, current_app, jsonify, request
from app.utils import PasswordService, get_db
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
        role = str(payload.get('user_category') or payload.get('user_role') or '').strip().title()
        review_note = str(payload.get('review_note') or '').strip()
        if status not in {'verified', 'rejected'}:
            return jsonify({'error': 'Choose verified or rejected'}), 400
        if status == 'verified' and role not in VERIFIED_CATEGORIES:
            return jsonify({'error': 'Choose a role for this user: Student, Faculty, Staff or Visitor'}), 400
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
            user_category=role if status == 'verified' else None,
            review_note=review_note,
        )
        display_name = reviewed.get('email') or account_id
        action = 'Verify User Account' if status == 'verified' else 'Reject User Verification'
        _log_admin_action(db, admin, action, 'Account Verification', display_name, account_id)
        notification_created = False
        try:
            if status == 'verified':
                notification_title = 'Account verification approved'
                notification_message = f"Your account is verified as {role}. You can now report items, file claims and bid in the Auction Hall."
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
        days = payload.get('days')
        if status == 'suspended' and days not in (None, ''):
            try:
                days = int(days)
            except (TypeError, ValueError):
                return jsonify({'error': 'Enter the suspension length in whole days'}), 400
            if days < 1 or days > 365:
                return jsonify({'error': 'A suspension must last between 1 and 365 days'}), 400
        else:
            days = None
        reason = str(payload.get('reason') or '').strip()[:300]

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
        if target_level in {'admin', 'super_admin'} and status == 'suspended' and actor.get('access_level') != 'super_admin':
            return jsonify({'error': 'Only a super administrator can suspend an administrator'}), 403
        updated = db.update_user_status(account_id, status, days=days, reason=reason, actor_id=actor.get('account_id'))
        action = 'Reactivate User' if status == 'active' else ('Suspend User for %d Days' % days if days else 'Suspend User')
        _log_admin_action(db, actor, action, 'Users', target.get('email') or account_id, account_id)
        message = 'The account was reactivated.' if status == 'active' else (f'The account is suspended for {days} days.' if days else 'The account is suspended until an admin reactivates it.')
        return jsonify({'user': updated, 'message': message}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except RuntimeError as error:
        return jsonify({'error': str(error)}), 409
    except Exception as error:
        current_app.logger.exception('Admin user status error: %s', error)
        return jsonify({'error': 'Unable to update user status', 'details': str(error)}), 500


@users_bp.route('/users/<account_id>/access-level', methods=['PATCH'])
def update_user_access_level(account_id):
    try:
        actor = _require_admin(required_level='super_admin')
        payload = request.get_json(silent=True) or {}
        access_level = str(payload.get('access_level') or '').strip().lower()
        if access_level not in {'user', 'guard', 'admin'}:
            return jsonify({'error': 'Access level must be user, guard or admin'}), 400

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


VERIFIED_CATEGORIES = {'Student', 'Faculty', 'Staff', 'Visitor'}
USER_ROLES = {'student': 'Student', 'faculty': 'Faculty', 'staff': 'Staff', 'others': 'Others'}
MIN_PASSWORD_LENGTH = 16
FIELD_LIMITS = {'fname': 100, 'mname': 100, 'lname': 100, 'campus_id': 50, 'email': 255}
REQUIRED_FIELD_LABELS = {'fname': 'First name', 'lname': 'Last name', 'campus_id': 'Campus ID', 'email': 'Email'}


def _map_admin_user(row):
    """Shape a user_profiles row like list_admin_users() so the admin UI can merge it directly."""
    return {
        'id': str(row.get('account_id')),
        'name': f"{row.get('fname') or ''} {row.get('lname') or ''}".strip(),
        'initials': (row.get('fname') or 'U')[0].upper() + (row.get('lname') or 'U')[0].upper(),
        'studentId': row.get('campus_id') or 'N/A',
        'email': row.get('email') or '',
        'program': row.get('user_role') or 'Student',
        'accessLevel': row.get('access_level') or 'user',
        'status': 'Active' if row.get('is_active') is not False else 'Suspended',
        'verification': str(row.get('verification_status') or 'pending').lower(),
        'category': row.get('user_category'),
        'suspendedUntil': row.get('suspended_until') if row.get('is_active') is False else None,
        'lastActivity': row.get('last_login_at') or row.get('created_at') or 'Unknown',
    }


def _clean_profile_fields(payload, partial):
    """Validate and normalise editable profile fields. Returns (fields, error_message)."""
    fields = {}
    for key in ('fname', 'mname', 'lname', 'campus_id', 'email'):
        if partial and key not in payload:
            continue
        value = str(payload.get(key) or '').strip()
        if key in REQUIRED_FIELD_LABELS and not value:
            return None, f'{REQUIRED_FIELD_LABELS[key]} is required'
        if len(value) > FIELD_LIMITS[key]:
            return None, f'{REQUIRED_FIELD_LABELS.get(key, "Middle name")} must be {FIELD_LIMITS[key]} characters or fewer'
        fields[key] = value
    if 'email' in fields:
        try:
            fields['email'] = validate_email(fields['email'], check_deliverability=False).normalized.lower()
        except EmailNotValidError:
            return None, 'Enter a valid email address'
    if 'user_role' in payload or not partial:
        role = USER_ROLES.get(str(payload.get('user_role') or 'student').strip().lower())
        if not role:
            return None, 'Role must be Student, Faculty, Staff, or Others'
        fields['user_role'] = role
    return fields, None


@users_bp.route('/users', methods=['POST'])
def create_user_account():
    """Create a standard user account (admins and super admins). Access levels are changed separately."""
    try:
        actor = _require_admin()
        payload = request.get_json(silent=True) or {}
        fields, error = _clean_profile_fields(payload, partial=False)
        if error:
            return jsonify({'error': error}), 400
        password = str(payload.get('password') or '')
        if len(password) < MIN_PASSWORD_LENGTH:
            return jsonify({'error': f'Temporary password must be at least {MIN_PASSWORD_LENGTH} characters'}), 400

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        if db.get_user_by_email(fields['email']):
            return jsonify({'error': 'An account with this email already exists'}), 409
        if db.get_user_by_campus_id(fields['campus_id']):
            return jsonify({'error': 'This campus ID is already registered to another account'}), 409

        created = db.create_user_profile({
            'account_id': str(uuid.uuid4()),
            **fields,
            'password_hash': PasswordService.hash_password(password),
            'auth_provider': 'local',
            'access_level': 'user',
            'is_active': True,
            'failed_login_attempts': 0,
            'locked_until': None,
            'last_login_at': None,
        })
        if not created:
            return jsonify({'error': 'Unable to create the account'}), 500
        _log_admin_action(db, actor, 'Create User', 'Users', fields['email'], created.get('account_id'))
        return jsonify({'user': _map_admin_user(created), 'message': f"Account created for {fields['email']}"}), 201
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin user creation error: %s', error)
        return jsonify({'error': 'Unable to create the account'}), 500


@users_bp.route('/users/<account_id>', methods=['PATCH'])
def update_user_account(account_id):
    """Edit profile details (names, email, campus ID, role). Super-admin accounts are editable only by super admins."""
    try:
        actor = _require_admin()
        payload = request.get_json(silent=True) or {}
        if any(key in payload for key in ('access_level', 'password', 'password_hash', 'is_active')):
            return jsonify({'error': 'Access level, status and password cannot be changed here'}), 400
        fields, error = _clean_profile_fields(payload, partial=True)
        if error:
            return jsonify({'error': error}), 400
        if not fields:
            return jsonify({'error': 'No changes were provided'}), 400

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        target = db.get_user_by_account_id(account_id)
        if not target:
            return jsonify({'error': 'User not found'}), 404
        if str(target.get('access_level') or '').lower() == 'super_admin' and actor.get('access_level') != 'super_admin':
            return jsonify({'error': 'Only a super administrator can edit a super administrator account'}), 403
        if 'email' in fields and fields['email'] != str(target.get('email') or '').lower():
            existing = db.get_user_by_email(fields['email'])
            if existing and str(existing.get('account_id')) != str(account_id):
                return jsonify({'error': 'An account with this email already exists'}), 409
        if 'campus_id' in fields and fields['campus_id'] != (target.get('campus_id') or ''):
            existing = db.get_user_by_campus_id(fields['campus_id'])
            if existing and str(existing.get('account_id')) != str(account_id):
                return jsonify({'error': 'This campus ID is already registered to another account'}), 409

        updated = db.update_user(account_id, {**fields, 'updated_at': datetime.now(timezone.utc).isoformat()})
        if not updated:
            return jsonify({'error': 'Unable to update the account'}), 500
        _log_admin_action(db, actor, 'Edit User', 'Users', updated.get('email') or account_id, account_id)
        return jsonify({'user': _map_admin_user(updated), 'message': 'Account details updated'}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin user edit error for %s: %s', account_id, error)
        return jsonify({'error': 'Unable to update the account'}), 500
