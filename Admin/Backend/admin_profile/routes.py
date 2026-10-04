"""Admin Profile page: authenticator (TOTP) MFA setup, status and disable."""
import pyotp
from datetime import datetime, timedelta, timezone
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db, JWTService, PasswordService
from app.utils.admin_mfa import generate_recovery_codes, hash_recovery_code, matched_totp_step, qr_data_uri
from app.utils.crypto_service import CryptoService
from Admin.Backend.shared.admin_access import _require_admin

admin_profile_bp = Blueprint('admin_admin_profile', __name__)


@admin_profile_bp.route('/mfa/status', methods=['GET'])
def admin_mfa_status():
    try:
        admin = _require_admin()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        record = db.get_admin_mfa(admin['account_id'])
        return jsonify({'enabled': bool(record and record.get('enabled_at'))}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception:
        current_app.logger.exception('Unable to load admin MFA status')
        return jsonify({'error': 'Unable to load authenticator status'}), 500


@admin_profile_bp.route('/mfa/setup', methods=['POST'])
def begin_admin_mfa_setup():
    try:
        admin = _require_admin()
        if not current_app.config.get('APP_ENCRYPTION_KEY'):
            return jsonify({'error': 'Set a stable APP_ENCRYPTION_KEY in the backend environment before enabling authenticator MFA'}), 503
        payload = request.get_json(silent=True) or {}
        password = str(payload.get('password') or '')
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        profile = db.get_user_by_account_id(admin['account_id'])
        if not profile or not profile.get('password_hash') or not PasswordService.verify_password(password, profile['password_hash']):
            return jsonify({'error': 'Enter your current account password to begin authenticator setup'}), 401
        current_mfa = db.get_admin_mfa(admin['account_id'])
        if current_mfa and current_mfa.get('enabled_at'):
            return jsonify({'error': 'Authenticator MFA is already enabled'}), 409

        secret = pyotp.random_base32()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        db.save_admin_mfa_pending(admin['account_id'], secret, expires_at.isoformat())
        provisioning_uri = pyotp.TOTP(secret).provisioning_uri(
            name=profile['email'],
            issuer_name='E-Balik Admin',
        )
        return jsonify({
            'qr_data_url': qr_data_uri(provisioning_uri),
            'manual_setup_key': secret,
            'expires_at': expires_at.isoformat(),
        }), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception:
        current_app.logger.exception('Unable to begin admin MFA setup')
        return jsonify({'error': 'Unable to start authenticator setup'}), 500


@admin_profile_bp.route('/mfa/verify-setup', methods=['POST'])
def verify_admin_mfa_setup():
    try:
        admin = _require_admin()
        payload = request.get_json(silent=True) or {}
        code = str(payload.get('code') or '').strip()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        record = db.get_admin_mfa(admin['account_id'])
        expires_at = record.get('pending_expires_at') if record else None
        pending_secret = CryptoService.decrypt(record.get('pending_secret_ciphertext')) if record else None
        locked_until = record.get('locked_until') if record else None
        if locked_until and datetime.fromisoformat(str(locked_until).replace('Z', '+00:00')) > datetime.now(timezone.utc):
            return jsonify({'error': 'Authenticator setup is temporarily locked. Try again later.'}), 423
        if not pending_secret or not expires_at or datetime.fromisoformat(str(expires_at).replace('Z', '+00:00')) <= datetime.now(timezone.utc):
            return jsonify({'error': 'Authenticator setup expired. Start setup again.'}), 400

        accepted_step = matched_totp_step(pending_secret, code)
        if accepted_step is None:
            db.record_admin_mfa_failure(admin['account_id'])
            return jsonify({'error': 'Code did not match. Check your phone and try again.'}), 400

        recovery_codes = generate_recovery_codes()
        db.replace_admin_mfa_recovery_codes(admin['account_id'], [hash_recovery_code(item) for item in recovery_codes])
        session_generation = db.enable_admin_mfa(admin['account_id'], pending_secret, accepted_step)
        profile = db.get_user_by_account_id(admin['account_id']) or {}
        db.log_user_activity(
            account_id=admin['account_id'],
            user_name=f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip() or profile.get('email') or 'Admin',
            action='Enable Authenticator MFA',
            module='Admin Security',
            target_name='Admin account',
            target_id=admin['account_id'],
            result='Success',
        )
        access_level = str(profile.get('access_level') or admin.get('access_level') or 'admin')
        token = JWTService.create_access_token(
            admin['account_id'], profile.get('email') or admin.get('email', ''),
            profile.get('user_role'), access_level, admin_mfa_verified=True,
            admin_mfa_generation=session_generation,
            expires_delta=timedelta(hours=12),
        )
        return jsonify({'enabled': True, 'recovery_codes': recovery_codes, 'token': token}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception:
        current_app.logger.exception('Unable to verify admin MFA setup')
        return jsonify({'error': 'Unable to enable authenticator MFA'}), 500


@admin_profile_bp.route('/mfa/disable', methods=['POST'])
def disable_admin_mfa():
    try:
        admin = _require_admin()
        payload = request.get_json(silent=True) or {}
        password = str(payload.get('password') or '')
        code = str(payload.get('code') or '').strip()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        profile = db.get_user_by_account_id(admin['account_id'])
        record = db.get_admin_mfa(admin['account_id'])
        if not profile or not profile.get('password_hash') or not PasswordService.verify_password(password, profile['password_hash']):
            return jsonify({'error': 'Current account password is incorrect'}), 401
        if not record or not record.get('enabled_at'):
            return jsonify({'error': 'Authenticator MFA is not enabled'}), 409
        locked_until = record.get('locked_until')
        if locked_until and datetime.fromisoformat(str(locked_until).replace('Z', '+00:00')) > datetime.now(timezone.utc):
            return jsonify({'error': 'Authenticator verification is temporarily locked. Try again later.'}), 423
        secret = CryptoService.decrypt(record.get('secret_ciphertext'))
        accepted_step = matched_totp_step(secret or '', code)
        if accepted_step is None:
            db.record_admin_mfa_failure(admin['account_id'])
            return jsonify({'error': 'Authenticator code is invalid'}), 401
        if not db.consume_admin_mfa_step(admin['account_id'], accepted_step):
            return jsonify({'error': 'Authenticator code was already used or MFA is locked'}), 401
        db.disable_admin_mfa(admin['account_id'])
        db.log_user_activity(
            account_id=admin['account_id'],
            user_name=f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip() or profile.get('email') or 'Admin',
            action='Disable Authenticator MFA',
            module='Admin Security',
            target_name='Admin account',
            target_id=admin['account_id'],
            result='Warning',
        )
        access_level = str(profile.get('access_level') or admin.get('access_level') or 'admin')
        token = JWTService.create_access_token(
            admin['account_id'], profile.get('email') or admin.get('email', ''),
            profile.get('user_role'), access_level, expires_delta=timedelta(hours=12),
        )
        return jsonify({'enabled': False, 'token': token}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception:
        current_app.logger.exception('Unable to disable admin MFA')
        return jsonify({'error': 'Unable to disable authenticator MFA'}), 500
