"""Home page: registration, OTP, login, Google login, admin MFA login, password reset, session check, landing found items."""
import hmac
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from flask import Blueprint, current_app, jsonify, request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from email_validator import EmailNotValidError, validate_email
from app.utils import EmailService, get_db, JWTService, OTPGenerator, PasswordService, otp_guard, rate_limit
from app.utils.otp_guard import OtpBlocked
from app.utils.text_guard import TextRejected, clean_field
from app.utils.admin_mfa import hash_recovery_code, matched_totp_step
from app.utils.crypto_service import CryptoService
from app.utils.system_control import login_block, public_status
from Users.Backend.shared.account import _ensure_email_normalized, _infer_user_role_and_campus, _verification_profile_metadata

logger = logging.getLogger(__name__)
home_bp = Blueprint('user_home', __name__)
_LOGIN_FAILURE_STORE = {}


def _blocked_response(error: OtpBlocked):
    """The JSON answer for a code rule (cooldown, daily limit, disposable email, too many guesses), with Retry-After when there is a wait."""
    response = jsonify(error.body())
    response.status_code = error.status
    if error.retry_after:
        response.headers['Retry-After'] = str(error.retry_after)
    return response


def _send_otp(db, email: str, otp_type: str) -> bool:
    """Retire the older unused codes, create a fresh one and email it. A code that could not be emailed is removed again, so a mail
    problem never uses up the person's daily limit."""
    db.invalidate_otps(email, otp_type)
    otp_code = OTPGenerator.generate_otp()
    stored = db.store_otp(
        email=email,
        otp_code=otp_code,
        otp_type=otp_type,
        expires_at=OTPGenerator.get_otp_expiration(minutes=current_app.config['OTP_EXPIRATION_MINUTES']),
    )
    sent = EmailService().send_otp_email(to_email=email, otp_code=otp_code, otp_type=otp_type)
    if not sent:
        db.discard_otp((stored or {}).get('id'))
    return bool(sent)


def _is_admin_profile(user: dict) -> bool:
    return _access_level(user) in {'admin', 'super_admin'}


def _is_staff_profile(user: dict) -> bool:
    """Admins, super admins and guards may use the staff console (a guard only sees the release desk there)."""
    return _access_level(user) in {'admin', 'super_admin', 'guard'}


def _access_level(user: dict) -> str:
    stored_level = str(user.get('access_level') or '').strip().lower()
    if stored_level in {'user', 'guard', 'admin', 'super_admin'}:
        return stored_level
    legacy_role = str(user.get('user_role') or '').strip().lower()
    if legacy_role == 'super_admin':
        return 'super_admin'
    if legacy_role == 'admin':
        return 'admin'
    return 'user'


def _get_runtime_lock_status(email: str):
    normalized_email = _ensure_email_normalized(email)
    if not normalized_email:
        return False, None, 0

    state = _LOGIN_FAILURE_STORE.get(normalized_email)
    if not state:
        return False, None, 0

    lock_until = _coerce_datetime(state.get('locked_until'))
    if lock_until is not None:
        now = datetime.now(timezone.utc)
        if now >= lock_until:
            _LOGIN_FAILURE_STORE.pop(normalized_email, None)
            return False, None, 0
        return True, lock_until, int(state.get('count', 0))

    return False, None, int(state.get('count', 0))


def _record_failed_login_attempt(email: str):
    normalized_email = _ensure_email_normalized(email)
    if not normalized_email:
        return False, None

    state = _LOGIN_FAILURE_STORE.setdefault(normalized_email, {'count': 0})
    state['count'] = int(state.get('count', 0)) + 1
    if state['count'] >= 3:
        state['locked_until'] = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
        return True, state['locked_until']
    return False, None


def _clear_failed_login_attempt(email: str):
    if email:
        _LOGIN_FAILURE_STORE.pop(_ensure_email_normalized(email), None)


def _coerce_datetime(value):
    if value in (None, ''):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    return None


def _get_account_lock_status(user: dict):
    lock_until = _coerce_datetime(user.get('locked_until'))
    if not lock_until:
        return False, None

    if lock_until.tzinfo is None:
        lock_until = lock_until.replace(tzinfo=timezone.utc)
    else:
        lock_until = lock_until.astimezone(timezone.utc)

    now = datetime.now(timezone.utc)
    return now < lock_until, lock_until


def _create_admin_mfa_challenge(db, account_id: str):
    challenge_id = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    db.create_admin_mfa_challenge(account_id, challenge_id, expires_at.isoformat())
    token = JWTService.create_admin_mfa_challenge(account_id, challenge_id)
    return token, expires_at


def _record_admin_mfa_failure(db, user: dict) -> None:
    account_id = str(user.get('account_id') or '')
    db.record_admin_mfa_failure(account_id)
    db.log_user_activity(
        account_id=account_id,
        user_name=f"{user.get('fname') or ''} {user.get('lname') or ''}".strip() or user.get('email') or 'Admin',
        action='Admin MFA Verification Failed',
        module='Admin Security',
        target_name='Admin sign-in',
        target_id=account_id,
        result='warning',
    )


@home_bp.route('/auth/register', methods=['POST'])
def register():
    """
    Register a new user
    Expected JSON:
    {
        "fname": "John",
        "mname": "Michael",
        "lname": "Doe",
        "email": "john.doe@umak.edu.ph",
        "campus_id": "A2023-12345",
        "password": "SecurePass123!"
    }
    """
    try:
        data = request.get_json() or {}
        normalized_email = _ensure_email_normalized(data.get('email'))
        data['email'] = normalized_email
        
        # Validate required fields
        required_fields = ['fname', 'lname', 'email', 'campus_id', 'password']
        if not all(field in data for field in required_fields):
            return jsonify({'error': 'Missing required fields'}), 400
        data['fname'] = clean_field(data.get('fname'), 'name', 'fname', 'first name')
        data['lname'] = clean_field(data.get('lname'), 'name', 'lname', 'last name')
        data['mname'] = clean_field(data.get('mname'), 'name', 'mname', 'middle name', required=False)
        
        # Validate email format
        try:
            validate_email(normalized_email, check_deliverability=False)
        except EmailNotValidError as e:
            return jsonify({'error': 'Invalid email format'}), 400

        otp_guard.block_disposable(normalized_email)
        otp_guard.check_ip(otp_guard.client_ip())

        # Validate password strength
        password = data['password']
        if len(password) < 16:
            return jsonify({'error': 'Password must be at least 16 characters'}), 400
        if not any(c.isupper() for c in password):
            return jsonify({'error': 'Password must contain uppercase letter'}), 400
        if not any(c.islower() for c in password):
            return jsonify({'error': 'Password must contain lowercase letter'}), 400
        if not any(c.isdigit() for c in password):
            return jsonify({'error': 'Password must contain number'}), 400
        if not any(c in '!@#$%^&*' for c in password):
            return jsonify({'error': 'Password must contain special character'}), 400
        
        # Get database instance
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        
        # Check if user already exists
        existing_user = db.get_user_by_email(normalized_email)
        if existing_user:
            return jsonify({'error': 'Email already registered'}), 409
        
        inferred_role, inferred_campus_id = _infer_user_role_and_campus(normalized_email, data.get('campus_id'))
        if inferred_role == 'Student':
            data['campus_id'] = inferred_campus_id
        elif not str(data.get('campus_id') or '').strip():
            data['campus_id'] = inferred_campus_id

        otp_guard.check_issue(db.client, normalized_email)

        if not _send_otp(db, normalized_email, 'registration'):
            return jsonify({'error': 'Failed to send verification email'}), 500

        # Store registration data temporarily (in production, use cache like Redis)
        # For now, we'll return success and require OTP verification
        logger.info(f"Registration initiated for {normalized_email}")

        return jsonify({
            'message': 'Registration initiated. Please check your email for verification code.',
            'email': normalized_email,
            'step': 'otp_verification',
            'cooldown': otp_guard.COOLDOWN_SECONDS,
        }), 200

    except TextRejected as error:
        return jsonify(error.body()), error.status
    except OtpBlocked as error:
        return _blocked_response(error)
    except Exception as e:
        logger.error(f"Registration error: {e}")
        return jsonify({'error': 'Registration failed', 'details': str(e)}), 500


@home_bp.route('/auth/verify-otp', methods=['POST'])
def verify_otp():
    """
    Verify OTP and complete registration
    Expected JSON:
    {
        "email": "john.doe@umak.edu.ph",
        "otp_code": "123456",
        "fname": "John",
        "mname": "Michael",
        "lname": "Doe",
        "campus_id": "A2023-12345",
        "password": "SecurePass123!"
    }
    """
    try:
        data = request.get_json() or {}
        data['email'] = _ensure_email_normalized(data.get('email'))
        data['otp_code'] = ''.join(str(data.get('otp_code') or '').split())

        # Validate required fields
        required_fields = ['email', 'otp_code', 'fname', 'lname', 'campus_id', 'password']
        if not all(field in data for field in required_fields):
            return jsonify({'error': 'Missing required fields'}), 400
        data['fname'] = clean_field(data.get('fname'), 'name', 'fname', 'first name')
        data['lname'] = clean_field(data.get('lname'), 'name', 'lname', 'last name')
        data['mname'] = clean_field(data.get('mname'), 'name', 'mname', 'middle name', required=False)
        otp_guard.check_verify_ip(otp_guard.client_ip())

        # Get database instance
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        
        normalized_email = _ensure_email_normalized(data['email'])

        # Verify OTP
        otp_record = db.get_otp_by_email(normalized_email, 'registration')
        if not otp_record:
            return jsonify({'error': 'Invalid or expired OTP'}), 400
        
        # Check if OTP is expired
        if OTPGenerator.is_otp_expired(otp_record['expires_at']):
            return jsonify({'error': 'OTP has expired'}), 400

        # Check if OTP matches. The fifth wrong guess kills the code (OtpBlocked), so it cannot be brute-forced.
        if not hmac.compare_digest(str(otp_record['otp_code']).strip(), data['otp_code']):
            remaining = otp_guard.register_failure(db.client, otp_record, normalized_email, 'registration')
            message = 'Invalid OTP code' + (f'. {remaining} attempt{"s" if remaining != 1 else ""} left.' if remaining is not None else '')
            return jsonify({'error': message, 'code': 'otp_invalid', **({'attempts_left': remaining} if remaining is not None else {})}), 400

        # Generate account ID
        account_id = str(uuid.uuid4())
        inferred_role, inferred_campus_id = _infer_user_role_and_campus(normalized_email, data.get('campus_id'))
        campus_id = inferred_campus_id if inferred_role == 'Student' else (data.get('campus_id') or inferred_campus_id or '').strip()

        existing_campus_user = db.get_user_by_campus_id(campus_id)
        if existing_campus_user and existing_campus_user.get('email') != normalized_email:
            return jsonify({'error': 'This campus ID is already registered to another account'}), 409

        # Hash password
        password_hash = PasswordService.hash_password(data['password'])
        
        # Create user profile
        user_data = {
            'account_id': account_id,
            'campus_id': campus_id,
            'fname': data['fname'].strip(),
            'mname': data.get('mname') or '',
            'lname': data['lname'].strip(),
            'email': normalized_email,
            'password_hash': password_hash,
            'user_role': inferred_role,
            'auth_provider': 'local',
            'failed_login_attempts': 0,
            'locked_until': None,
            'created_at': 'now()',
            'last_login_at': None
        }
        
        user = db.create_user_profile(user_data)
        if not user:
            return jsonify({'error': 'Unable to create the account profile'}), 500
        
        # Consume the matching OTP after the account has been created. The profile
        # is already valid at this point, so cleanup must not replace success.
        try:
            if not db.verify_otp(normalized_email, data['otp_code'], 'registration'):
                logger.warning(f"Registration OTP cleanup did not complete for {normalized_email}")
        except Exception as otp_cleanup_error:
            logger.warning(f"Registration OTP cleanup failed for {normalized_email}: {otp_cleanup_error}")
        
        # Send welcome email
        email_service = EmailService()
        email_service.send_welcome_email(normalized_email, data['fname'].strip())
        
        # Create JWT token
        token = JWTService.create_access_token(account_id, normalized_email)
        
        logger.info(f"User registered successfully: {normalized_email}")
        
        return jsonify({
            'message': 'Registration successful',
            'account_id': account_id,
            'email': normalized_email,
            'fname': user_data['fname'],
            'mname': user_data['mname'],
            'lname': user_data['lname'],
            'campus_id': campus_id,
            'user_role': inferred_role,
            'token': token
        }), 201
    
    except TextRejected as error:
        return jsonify(error.body()), error.status
    except OtpBlocked as error:
        return _blocked_response(error)
    except Exception as e:
        logger.error(f"OTP verification error: {e}")
        return jsonify({'error': 'Verification failed', 'details': str(e)}), 500


@home_bp.route('/auth/login', methods=['POST'])
def login():
    """
    Login user
    Expected JSON:
    {
        "email": "john.doe@umak.edu.ph",
        "password": "SecurePass123!"
    }
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data.get('email') or not data.get('password'):
            return jsonify({'error': 'Email and password are required'}), 400
        
        # Get database instance
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        
        normalized_email = _ensure_email_normalized(data['email'])

        # Get user
        user = db.get_user_by_email(normalized_email)
        if not user:
            return jsonify({'error': 'No account registered using this Email'}), 404

        runtime_locked, _, _ = _get_runtime_lock_status(normalized_email)
        is_locked, lock_until = _get_account_lock_status(user)
        if runtime_locked or is_locked:
            return jsonify({'error': 'Account temporarily locked. Please try again in 2 minutes.'}), 423

        password_hash = user.get('password_hash') or ''

        # Allow both local and Google-authenticated accounts to use the local login flow
        # when a password hash exists. Google-only accounts without a password remain
        # blocked from email/password auth unless they set a password explicitly.

        # Verify password
        if not password_hash or not PasswordService.verify_password(data['password'], password_hash):
            if getattr(db, 'supports_profile_auth_fields', False):
                failed_attempts = int(user.get('failed_login_attempts') or 0) + 1
                if failed_attempts >= 3:
                    lock_until = datetime.utcnow() + timedelta(minutes=2)
                    db.update_user(user['account_id'], {
                        'failed_login_attempts': 3,
                        'locked_until': lock_until.isoformat()
                    })
                    return jsonify({'error': 'Too many incorrect attempts. Your account is locked for 2 minutes.'}), 423

                db.update_user(user['account_id'], {
                    'failed_login_attempts': failed_attempts,
                    'locked_until': None
                })
            else:
                is_locked_now, _ = _record_failed_login_attempt(normalized_email)
                if is_locked_now:
                    return jsonify({'error': 'Too many incorrect attempts. Your account is locked for 2 minutes.'}), 423

            return jsonify({'error': 'Invalid email or password'}), 401

        blocked = login_block(db, user)
        if blocked is not None:
            return blocked

        access_level = _access_level(user)
        if data.get('admin_only') and not _is_staff_profile(user):
            return jsonify({'error': 'Admin access is required'}), 403
        if data.get('admin_only') and user.get('is_active') is False:
            return jsonify({'error': 'This account is inactive'}), 403

        if access_level in {'admin', 'super_admin'}:
            mfa_record = db.get_admin_mfa(user['account_id'])
            if mfa_record and mfa_record.get('enabled_at'):
                locked_until = _coerce_datetime(mfa_record.get('locked_until'))
                if locked_until and locked_until > datetime.now(timezone.utc):
                    return jsonify({'error': 'Authenticator verification is temporarily locked. Try again later.'}), 423
                challenge_token, challenge_expires = _create_admin_mfa_challenge(db, user['account_id'])
                return jsonify({
                    'message': 'Authenticator verification required',
                    'mfa_required': True,
                    'challenge_token': challenge_token,
                    'expires_at': challenge_expires.isoformat(),
                }), 200
        
        # Update last login
        if getattr(db, 'supports_profile_auth_fields', False):
            db.update_user(user['account_id'], {
                'failed_login_attempts': 0,
                'locked_until': None,
                'last_login_at': 'now()'
            })
        _clear_failed_login_attempt(normalized_email)
        
        # Create JWT token
        token = JWTService.create_access_token(user['account_id'], user['email'], user.get('user_role'), access_level)
        verification_metadata = _verification_profile_metadata(db, user)
        
        logger.info(f"User logged in: {normalized_email}")
        
        return jsonify({
            'message': 'Login successful',
            'account_id': user['account_id'],
            'email': user['email'],
            'fname': user['fname'],
            'mname': user.get('mname', ''),
            'lname': user['lname'],
            'campus_id': user.get('campus_id', ''),
            'user_role': user.get('user_role'),
            'access_level': access_level,
            **verification_metadata,
            'token': token
        }), 200
    
    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({'error': 'Login failed', 'details': str(e)}), 500


@home_bp.route('/auth/email-available', methods=['GET'])
def email_available():
    """Lets the sign-up form say "already registered" while the person is still typing, before anything is submitted.

    Throttled per address. Answers only yes or no, never any detail of the account.
    """
    ip = otp_guard.client_ip()
    if not rate_limit.allow(f'email-available:{ip}', 40, 60):
        return jsonify({'error': 'Too many checks. Wait a moment and try again.'}), 429
    email = _ensure_email_normalized(request.args.get('email'))
    try:
        validate_email(email, check_deliverability=False)
    except EmailNotValidError:
        return jsonify({'valid': False, 'available': None}), 200
    try:
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        taken = bool(db.get_user_by_email(email))
    except Exception as error:
        current_app.logger.warning('Email availability check failed: %s', error)
        return jsonify({'valid': True, 'available': None}), 200
    reply = jsonify({'valid': True, 'available': not taken})
    reply.headers['Cache-Control'] = 'no-store'
    return reply, 200


@home_bp.route('/auth/google-login', methods=['POST'])
def google_login():
    """Authenticate a Google ID token. If no account exists, return a no-account payload so the UI can prompt registration."""
    try:
        data = request.get_json() or {}
        credential = data.get('credential')
        if not credential:
            return jsonify({'error': 'Google credential is required'}), 400

        client_id = current_app.config.get('GOOGLE_CLIENT_ID')
        if not client_id:
            return jsonify({'error': 'Google client ID is not configured'}), 500

        idinfo = id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            client_id
        )

        email = _ensure_email_normalized(idinfo.get('email'))
        if not email or not idinfo.get('email_verified'):
            return jsonify({'error': 'Google email is not verified'}), 401

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )

        user = db.get_user_by_email(email)
        google_profile = {
            'email': email,
            'fname': (idinfo.get('given_name') or 'Google').strip() or 'Google',
            'lname': (idinfo.get('family_name') or 'User').strip() or 'User',
            'campus_id': '',
        }
        inferred_role, inferred_campus_id = _infer_user_role_and_campus(email, None)
        google_profile['role'] = inferred_role
        google_profile['campus_id'] = inferred_campus_id or ''

        if not user:
            return jsonify({
                'message': 'No account registered using this Email. Please register first.',
                'code': 'REGISTER_REQUIRED',
                'google_profile': google_profile,
            }), 200

        if user.get('email') and user.get('email') != email:
            return jsonify({
                'message': 'This email is already registered with a different account.',
                'code': 'EMAIL_ALREADY_REGISTERED',
                'google_profile': google_profile,
            }), 200

        if str(data.get('purpose') or '').lower() == 'register':
            # Registering with an email that already has an account: say so at once, and never sign anyone in from the sign-up page.
            return jsonify({
                'message': 'This email is already registered. Log in instead, or use "Forgot password" if you cannot remember it.',
                'code': 'EMAIL_ALREADY_REGISTERED',
                'google_profile': google_profile,
            }), 200

        # Allow a registered local user to sign in with the same email via Google.
        # The account should not be forced to be an admin just because it is using
        # Google authentication.
        blocked = login_block(db, user)
        if blocked is not None:
            return blocked

        if getattr(db, 'supports_profile_auth_fields', False):
            if (user.get('auth_provider') in (None, 'local', 'google')) and idinfo.get('sub'):
                db.update_user(user['account_id'], {'google_sub': str(idinfo.get('sub')), 'auth_provider': 'google'})
                user['google_sub'] = str(idinfo.get('sub'))
                user['auth_provider'] = 'google'

        runtime_locked, _, _ = _get_runtime_lock_status(email)
        is_locked, _ = _get_account_lock_status(user)
        if runtime_locked or is_locked:
            return jsonify({'error': 'Account temporarily locked. Please try again in 2 minutes.'}), 423

        _clear_failed_login_attempt(email)

        access_level = _access_level(user)
        if access_level in {'admin', 'super_admin'}:
            mfa_record = db.get_admin_mfa(user['account_id'])
            if mfa_record and mfa_record.get('enabled_at'):
                locked_until = _coerce_datetime(mfa_record.get('locked_until'))
                if locked_until and locked_until > datetime.now(timezone.utc):
                    return jsonify({'error': 'Authenticator verification is temporarily locked. Try again later.'}), 423
                challenge_token, challenge_expires = _create_admin_mfa_challenge(db, user['account_id'])
                return jsonify({
                    'message': 'Authenticator verification required',
                    'code': 'MFA_REQUIRED',
                    'mfa_required': True,
                    'challenge_token': challenge_token,
                    'expires_at': challenge_expires.isoformat(),
                }), 200

        if getattr(db, 'supports_profile_auth_fields', False):
            db.update_user(user['account_id'], {
                'failed_login_attempts': 0,
                'locked_until': None,
                'last_login_at': 'now()'
            })

        token = JWTService.create_access_token(user['account_id'], user['email'], user.get('user_role'), access_level)
        verification_metadata = _verification_profile_metadata(db, user)

        return jsonify({
            'message': 'Google login successful',
            'code': 'LOGIN_SUCCESS',
            'account_id': user['account_id'],
            'email': user['email'],
            'fname': user.get('fname', ''),
            'mname': user.get('mname', ''),
            'lname': user.get('lname', ''),
            'campus_id': user.get('campus_id', ''),
            'role': user.get('user_role') or 'Others',
            'user_role': user.get('user_role') or 'Others',
            'access_level': access_level,
            **verification_metadata,
            'token': token
        }), 200

    except ValueError as e:
        logger.warning(f"Google login token verification failed: {e}")
        return jsonify({'error': 'Google login failed. Please try again.'}), 401
    except Exception as e:
        logger.error(f"Google login error: {e}")
        return jsonify({'error': 'Google login failed', 'details': str(e)}), 500


@home_bp.route('/auth/admin-mfa/verify', methods=['POST'])
def verify_admin_mfa_login():
    try:
        data = request.get_json(silent=True) or {}
        challenge_token = data.get('challenge_token') or ''
        code = str(data.get('code') or '').strip()
        if not challenge_token or not code:
            return jsonify({'error': 'Authenticator code and challenge are required'}), 400

        challenge = JWTService.verify_admin_mfa_challenge(challenge_token)
        if challenge.get('purpose') != 'admin_mfa' or not challenge.get('challenge_id'):
            return jsonify({'error': 'Invalid authenticator challenge'}), 401

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        account_id = str(challenge.get('account_id') or '')
        user = db.get_user_by_account_id(account_id)
        if not user or user.get('is_active') is False or _access_level(user) not in {'admin', 'super_admin'}:
            return jsonify({'error': 'Active administrator account not found'}), 403

        mfa_record = db.get_admin_mfa(account_id)
        if not mfa_record or not mfa_record.get('enabled_at'):
            return jsonify({'error': 'Authenticator MFA is not enabled for this account'}), 403
        locked_until = _coerce_datetime(mfa_record.get('locked_until'))
        if locked_until and locked_until > datetime.now(timezone.utc):
            return jsonify({'error': 'Authenticator verification is temporarily locked. Try again later.'}), 423

        accepted_step = None
        is_recovery_code = not bool(re.fullmatch(r'\d{6}', code))
        if is_recovery_code:
            recovery_hash = hash_recovery_code(code)
            if not db.consume_admin_mfa_recovery_code(account_id, recovery_hash, str(challenge['challenge_id'])):
                _record_admin_mfa_failure(db, user)
                return jsonify({'error': 'Invalid or already-used recovery code'}), 401
        else:
            secret = CryptoService.decrypt(mfa_record.get('secret_ciphertext'))
            if not secret:
                current_app.logger.error('Unable to decrypt admin MFA secret for account %s', account_id)
                return jsonify({'error': 'Authenticator configuration is unavailable. Contact a super administrator.'}), 500
            accepted_step = matched_totp_step(secret, code)
            if accepted_step is None:
                _record_admin_mfa_failure(db, user)
                return jsonify({'error': 'Invalid authenticator code'}), 401

        if not is_recovery_code and not db.consume_admin_mfa_challenge(str(challenge['challenge_id']), account_id, accepted_step):
            return jsonify({'error': 'Authenticator challenge expired, used, or code was already accepted'}), 401

        if getattr(db, 'supports_profile_auth_fields', False):
            db.update_user(account_id, {'failed_login_attempts': 0, 'locked_until': None, 'last_login_at': 'now()'})

        access_level = _access_level(user)
        token = JWTService.create_access_token(
            account_id,
            user['email'],
            user.get('user_role'),
            access_level,
            admin_mfa_verified=True,
            admin_mfa_generation=int(mfa_record.get('session_generation') or 0),
        )
        return jsonify({
            'message': 'Authenticator verified',
            'account_id': account_id,
            'email': user['email'],
            'fname': user.get('fname', ''),
            'mname': user.get('mname', ''),
            'lname': user.get('lname', ''),
            'campus_id': user.get('campus_id', ''),
            'user_role': user.get('user_role'),
            'access_level': access_level,
            'token': token,
        }), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.exception('Admin MFA login verification failed')
        return jsonify({'error': 'Unable to verify authenticator code'}), 500


@home_bp.route('/auth/forgot-password', methods=['POST'])
def forgot_password():
    """
    Initiate password reset process
    Expected JSON:
    {
        "email": "john.doe@umak.edu.ph"
    }
    """
    try:
        data = request.get_json(silent=True) or {}

        if not data.get('email'):
            return jsonify({'error': 'Email is required'}), 400
        return _password_reset_code(str(data['email']))
    except OtpBlocked as error:
        return _blocked_response(error)
    except Exception as e:
        logger.error(f"Forgot password error: {e}")
        return jsonify({'error': 'Failed to initiate password reset', 'details': str(e)}), 500


def _password_reset_code(raw_email: str):
    """Send a password reset code. The answer is the same whether or not the account exists. The cooldown and the daily limit are kept
    per email address in memory, so they cannot be used to find out which emails have accounts; the database-counted daily limit only
    ever changes whether a code is sent, never what is said."""
    email = raw_email.strip().lower()
    generic = {'message': 'If the email exists, a password reset link has been sent', 'cooldown': otp_guard.COOLDOWN_SECONDS}
    otp_guard.check_ip(otp_guard.client_ip())
    otp_guard.check_memory(email)
    db = get_db(
        url=current_app.config['SUPABASE_URL'],
        service_key=current_app.config['SUPABASE_SERVICE_KEY']
    )
    user = db.get_user_by_email(email) or db.get_user_by_email(raw_email)
    if not user or otp_guard.daily_limit_reached(db.client, email):
        return jsonify(generic), 200
    if not _send_otp(db, user.get('email') or email, 'password_reset'):
        return jsonify({'error': 'Failed to send password reset email'}), 500
    logger.info(f"Password reset initiated for {email}")
    return jsonify(generic), 200


@home_bp.route('/auth/resend-otp', methods=['POST'])
def resend_otp():
    """
    Send a fresh code. The older code stops working.
    Expected JSON: {"email": "john.doe@umak.edu.ph", "type": "registration" | "password_reset"}
    Subject to the same 60 second cooldown, daily limit and disposable-email rules as the first request.
    """
    try:
        data = request.get_json(silent=True) or {}
        otp_type = str(data.get('type') or 'registration').strip().lower()
        if otp_type not in ('registration', 'password_reset'):
            return jsonify({'error': 'Choose registration or password_reset.'}), 400
        if not str(data.get('email') or '').strip():
            return jsonify({'error': 'Email is required'}), 400
        if otp_type == 'password_reset':
            return _password_reset_code(str(data['email']))

        email = _ensure_email_normalized(data.get('email'))
        try:
            validate_email(email, check_deliverability=False)
        except EmailNotValidError:
            return jsonify({'error': 'Invalid email format'}), 400
        otp_guard.block_disposable(email)
        otp_guard.check_ip(otp_guard.client_ip())
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        if db.get_user_by_email(email):
            return jsonify({'error': 'Email already registered'}), 409
        otp_guard.check_issue(db.client, email)
        if not _send_otp(db, email, 'registration'):
            return jsonify({'error': 'Failed to send verification email'}), 500
        return jsonify({'message': 'A new code was sent. The previous code no longer works.', 'email': email, 'cooldown': otp_guard.COOLDOWN_SECONDS}), 200
    except OtpBlocked as error:
        return _blocked_response(error)
    except Exception as e:
        logger.error(f"Resend OTP error: {e}")
        return jsonify({'error': 'Could not send a new code', 'details': str(e)}), 500


@home_bp.route('/auth/reset-password', methods=['POST'])
def reset_password():
    """
    Reset password with OTP verification
    Expected JSON:
    {
        "email": "john.doe@umak.edu.ph",
        "otp_code": "123456",
        "new_password": "NewSecurePass123!"
    }
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['email', 'otp_code', 'new_password']
        if not all(field in data for field in required_fields):
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate new password
        password = data['new_password']
        if len(password) < 16:
            return jsonify({'error': 'Password must be at least 16 characters'}), 400
        otp_guard.check_verify_ip(otp_guard.client_ip())

        # Get database instance
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )

        # Verify OTP
        otp_record = db.get_otp_by_email(data['email'], 'password_reset')
        if not otp_record:
            return jsonify({'error': 'Invalid or expired OTP'}), 400

        if OTPGenerator.is_otp_expired(otp_record['expires_at']):
            return jsonify({'error': 'OTP has expired'}), 400

        # The fifth wrong guess kills the code (OtpBlocked), so it cannot be brute-forced.
        if not hmac.compare_digest(str(otp_record['otp_code']).strip(), ''.join(str(data['otp_code']).split())):
            remaining = otp_guard.register_failure(db.client, otp_record, str(data['email']).strip().lower(), 'password_reset')
            message = 'Invalid OTP code' + (f'. {remaining} attempt{"s" if remaining != 1 else ""} left.' if remaining is not None else '')
            return jsonify({'error': message, 'code': 'otp_invalid', **({'attempts_left': remaining} if remaining is not None else {})}), 400
        
        # Get user
        user = db.get_user_by_email(data['email'])
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Hash new password
        password_hash = PasswordService.hash_password(password)
        
        # Update user password
        db.update_user(user['account_id'], {'password_hash': password_hash})
        
        # Mark OTP as used
        db.verify_otp(data['email'], data['otp_code'], 'password_reset')
        
        logger.info(f"Password reset completed for {data['email']}")
        
        return jsonify({
            'message': 'Password reset successful'
        }), 200
    
    except OtpBlocked as error:
        return _blocked_response(error)
    except Exception as e:
        logger.error(f"Reset password error: {e}")
        return jsonify({'error': 'Password reset failed', 'details': str(e)}), 500


@home_bp.route('/auth/verify-token', methods=['GET'])
def verify_token():
    """
    Verify JWT token
    Expected header:
    Authorization: Bearer <token>
    """
    try:
        auth_header = request.headers.get('Authorization', '')
        
        if not auth_header:
            return jsonify({'error': 'Missing authorization header'}), 401
        
        token = JWTService.extract_token_from_header(auth_header)
        payload = JWTService.verify_token(token)
        
        return jsonify({
            'message': 'Token is valid',
            'account_id': payload['account_id'],
            'email': payload['email']
        }), 200
    
    except ValueError as e:
        return jsonify({'error': str(e)}), 401
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        return jsonify({'error': 'Token verification failed'}), 401


@home_bp.route('/found-items/public', methods=['GET'])
def list_public_found_items():
    """List safe, unclaimed found-item fields without requiring authentication."""
    try:
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        return jsonify({'items': db.get_public_found_items(limit=4)}), 200
    except Exception as error:
        current_app.logger.exception(f'Public found item listing error: {error}')
        return jsonify({'error': 'Unable to load recent found items'}), 500


@home_bp.route('/public/board', methods=['GET'])
def public_board():
    """Newest missing reports and found items plus totals for the public landing page (safe fields only, no login)."""
    try:
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        return jsonify(db.get_public_board(missing_limit=8, found_limit=8)), 200
    except Exception as error:
        current_app.logger.exception(f'Public board error: {error}')
        return jsonify({'error': 'Unable to load recent reports'}), 500


@home_bp.route('/system/status', methods=['GET'])
def system_status():
    """Public flag the apps poll to show the maintenance screen. Never exposes anything else."""
    try:
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        return jsonify(public_status(db)), 200
    except Exception as error:
        current_app.logger.warning(f'System status unavailable: {error}')
        return jsonify({'maintenance': False, 'message': '', 'since': None, 'announcement': None}), 200
