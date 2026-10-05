"""Profile page: profile read/update and verification document upload."""
import logging
import uuid
from datetime import datetime, timezone
from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename
from app.utils import get_db, JWTService
from Users.Backend.shared.account import _infer_user_role_and_campus, _verification_profile_metadata
from Users.Backend.shared.privacy import DPA_REQUIRED_MESSAGE, dpa_consent_given

logger = logging.getLogger(__name__)
profile_bp = Blueprint('user_profile', __name__)


@profile_bp.route('/auth/profile', methods=['GET', 'PUT'])
def update_profile():
    """Read or update the authenticated user's profile data."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header:
            return jsonify({'error': 'Missing authorization header'}), 401

        token = JWTService.extract_token_from_header(auth_header)
        payload = JWTService.verify_token(token)

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )

        current_user = db.get_user_by_account_id(payload['account_id'])
        if not current_user:
            return jsonify({'error': 'User not found'}), 404

        if request.method == 'GET':
            verification_metadata = _verification_profile_metadata(db, current_user)
            return jsonify({
                'user': {
                    'account_id': current_user['account_id'],
                    'campus_id': current_user.get('campus_id', ''),
                    'fname': current_user.get('fname', ''),
                    'mname': current_user.get('mname', ''),
                    'lname': current_user.get('lname', ''),
                    'email': current_user.get('email', ''),
                    'user_role': current_user.get('user_role') or 'Others',
                    'access_level': current_user.get('access_level') or 'user',
                    **verification_metadata,
                }
            }), 200

        data = request.get_json() or {}
        if not data:
            return jsonify({'error': 'Profile data is required'}), 400

        if not data.get('fname') or not data.get('lname') or not data.get('email'):
            return jsonify({'error': 'First name, last name, and email are required'}), 400

        requested_email = data['email'].strip().lower()
        if requested_email != current_user['email']:
            existing_user = db.get_user_by_email(requested_email)
            if existing_user:
                return jsonify({'error': 'Email already registered'}), 409

        inferred_role, inferred_campus_id = _infer_user_role_and_campus(requested_email, data.get('campus_id') or current_user.get('campus_id'))
        verified = str(current_user.get('verification_status') or '').lower() == 'verified'
        new_campus_id = (data.get('campus_id') or inferred_campus_id or current_user.get('campus_id') or '').strip()
        if verified and (requested_email != current_user['email'] or new_campus_id != (current_user.get('campus_id') or '')):
            # The admin verified this email and campus ID against an uploaded document; changing them would void that check.
            return jsonify({'error': 'Your email and campus ID are locked after verification. Contact the Lost and Found Office to change them.'}), 409
        updated_fields = {
            'fname': data['fname'].strip(),
            'mname': (data.get('mname') or '').strip(),
            'lname': data['lname'].strip(),
            'email': requested_email,
            'campus_id': new_campus_id,
            'updated_at': 'now()',
        }
        if not verified:
            # Before verification the role is only a guess from the email. Once an admin has assigned a role it is never overwritten here.
            updated_fields['user_role'] = inferred_role

        db.update_user(payload['account_id'], updated_fields)
        updated_user = db.get_user_by_account_id(payload['account_id'])

        return jsonify({
            'message': 'Profile updated successfully',
            'user': {
                'account_id': updated_user['account_id'],
                'campus_id': updated_user.get('campus_id', ''),
                'fname': updated_user.get('fname', ''),
                'mname': updated_user.get('mname', ''),
                'lname': updated_user.get('lname', ''),
                'email': updated_user.get('email', ''),
                'user_role': updated_user.get('user_role') or 'Others',
                'user_category': updated_user.get('user_category') or '',
                'verification_status': updated_user.get('verification_status') or 'pending',
            }
        }), 200

    except ValueError as e:
        return jsonify({'error': str(e)}), 401
    except Exception as e:
        logger.error(f"Profile update error: {e}")
        return jsonify({'error': 'Profile update failed', 'details': str(e)}), 500


@profile_bp.route('/auth/profile/document-upload', methods=['POST'])
def upload_verification_document():
    """Stores the verification document metadata for an authenticated user."""
    uploaded_path = None
    failure_stage = 'request validation'
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header:
            return jsonify({'error': 'Missing authorization header'}), 401

        token = JWTService.extract_token_from_header(auth_header)
        payload = JWTService.verify_token(token)

        document = request.files.get('document')
        document_type = str(request.form.get('document_type') or 'government_id').strip().lower()
        allowed_mime_types = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'application/pdf': 'pdf',
        }
        if not document or not document.filename:
            return jsonify({'error': 'Choose a verification document to upload'}), 400
        if not dpa_consent_given(request.form):
            return jsonify({'error': DPA_REQUIRED_MESSAGE, 'code': 'dpa_required'}), 400
        if document.mimetype not in allowed_mime_types:
            return jsonify({'error': 'Use a JPG, PNG, WEBP, or PDF document'}), 400

        file_bytes = document.read()
        if not file_bytes or len(file_bytes) > 10 * 1024 * 1024:
            return jsonify({'error': 'Documents must be non-empty and 10 MB or smaller'}), 400

        failure_stage = 'connecting to Supabase'
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )

        failure_stage = 'loading the account profile'
        user = db.get_user_by_account_id(payload['account_id'])
        if not user:
            return jsonify({'error': 'User not found'}), 404

        type_labels = {
            'cor': 'Certificate of Registration (COR)',
            'student_id': 'Student / Campus ID',
            'campus_id': 'Student / Campus ID',
            'government_id': 'Government ID',
        }
        if document_type not in type_labels:
            return jsonify({'error': 'Choose a supported verification document type'}), 400

        failure_stage = 'preparing document metadata'
        normalized_name = secure_filename(document.filename) or f'verification-document.{allowed_mime_types[document.mimetype]}'
        document_name = document.filename[:255]
        selected_type = type_labels[document_type]
        bucket = 'account-verification-documents'
        uploaded_path = f"{payload['account_id']}/{uuid.uuid4().hex}-{normalized_name}"

        old_profile = db._decrypt_profile_sensitive_fields(user) or user
        try:
            failure_stage = 'private document storage'
            db.client.storage.from_(bucket).upload(
                uploaded_path,
                file_bytes,
                {'content-type': document.mimetype, 'upsert': 'false'},
            )
            failure_stage = 'verification request registration'
            db.store_verification_document(
                account_id=payload['account_id'],
                document_name=document_name,
                document_type=selected_type,
                document_url=uploaded_path,
                document_bucket=bucket,
                verification_status='pending',
            )
        except Exception:
            try:
                db.client.storage.from_(bucket).remove([uploaded_path])
            except Exception:
                current_app.logger.warning('Unable to clean up failed verification upload for account %s', payload['account_id'])
            raise

        old_path = old_profile.get('verification_document_url')
        old_bucket = old_profile.get('verification_document_bucket')
        if old_path and old_bucket and (old_path != uploaded_path or old_bucket != bucket):
            try:
                db.client.storage.from_(old_bucket).remove([old_path])
            except Exception as cleanup_error:
                current_app.logger.warning('Unable to remove replaced verification document: %s', cleanup_error)

        return jsonify({
            'message': 'Verification document uploaded successfully',
            'status': 'pending',
            'document_name': document_name,
            'document_type': selected_type,
            'uploaded_at': datetime.now(timezone.utc).isoformat(),
        }), 200

    except ValueError as e:
        return jsonify({'error': str(e)}), 401
    except Exception as e:
        current_app.logger.exception('Verification upload failed during %s', failure_stage)
        error_text = str(e).lower()
        def failure_response(message, status_code):
            if current_app.debug:
                message = f'{message} Debug detail: {str(e)[:300]}'
            return jsonify({'error': message}), status_code

        migration_fields = (
            'verification_review_note',
            'verification_reviewed_at',
            'verification_reviewed_by',
        )
        migration_required = (
            ('bucket' in error_text and any(marker in error_text for marker in ('not found', 'does not exist', 'missing')))
            or any(field in error_text for field in migration_fields)
        )
        if migration_required:
            return failure_response(
                'Account verification storage is not initialized. Run backend/manual_migrations/20260930_account_verification_review.sql in the Supabase SQL Editor, then retry the upload.',
                503,
            )
        if failure_stage == 'connecting to Supabase':
            return failure_response('The server could not connect to Supabase. Please retry shortly or contact support.', 503)
        if failure_stage == 'loading the account profile':
            return failure_response('Your account could not be loaded for verification. Sign out and back in, then retry.', 503)
        if failure_stage == 'private document storage':
            return failure_response(
                'The document could not be saved to private storage. Please retry; if it continues, ask an administrator to check Supabase Storage access.',
                502,
            )
        if failure_stage == 'verification request registration':
            return failure_response(
                'The document could not be attached to your verification request. No request was submitted; please retry or contact support.',
                500,
            )
        if failure_stage == 'preparing document metadata':
            return failure_response('The document details could not be prepared. Rename the file and try again.', 400)
        return failure_response(
            'The verification upload request could not be processed. Select the file again and retry.',
            500,
        )
