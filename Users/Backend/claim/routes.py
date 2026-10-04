"""Claim page: submit, list and cancel claims."""
from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename
import uuid

from app.utils import JWTService, get_db
from app.utils.email_service import send_reference_email_best_effort

claims_bp = Blueprint('claims', __name__)
ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}
ALLOWED_ID_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'application/pdf'}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def _account_id():
    token = JWTService.extract_token_from_header(request.headers.get('Authorization', ''))
    payload = JWTService.verify_token(token)
    return payload.get('account_id')


def _signed_url(db, bucket, path):
    if not path:
        return None
    result = db.client.storage.from_(bucket).create_signed_url(path, 300)
    if isinstance(result, dict):
        return result.get('signedURL') or result.get('signedUrl') or result.get('signed_url') or result.get('url')
    return None


def _has_valid_signature(content: bytes, mime_type: str) -> bool:
    if mime_type == 'image/jpeg':
        return content.startswith(b'\xff\xd8\xff')
    if mime_type == 'image/png':
        return content.startswith(b'\x89PNG\r\n\x1a\n')
    if mime_type == 'image/webp':
        return len(content) >= 12 and content.startswith(b'RIFF') and content[8:12] == b'WEBP'
    if mime_type == 'image/gif':
        return content.startswith((b'GIF87a', b'GIF89a'))
    if mime_type == 'application/pdf':
        return content.startswith(b'%PDF-')
    return False


@claims_bp.route('', methods=['GET', 'POST'])
def claims():
    try:
        account_id = _account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if request.method == 'GET':
            return jsonify({'claims': db.get_claims_by_account(account_id)}), 200

        fpost_id = str(request.form.get('fpost_id') or '').strip()
        claim_reason = str(request.form.get('claim_reason') or '').strip()
        proof = request.files.get('proof_image')
        identity_document = request.files.get('identity_document')
        identity_document_type = str(request.form.get('identity_document_type') or '').strip().lower()
        if not fpost_id or not claim_reason:
            return jsonify({'error': 'Found item reference and claim reason are required'}), 400
        if not proof or not proof.filename:
            return jsonify({'error': 'Ownership proof photo is required'}), 400
        if proof.mimetype not in ALLOWED_IMAGE_TYPES:
            return jsonify({'error': 'Use a JPG, PNG, WEBP, or GIF proof image'}), 400
        if not identity_document or not identity_document.filename:
            return jsonify({'error': 'A school or government ID document is required'}), 400
        if identity_document.mimetype not in ALLOWED_ID_TYPES:
            return jsonify({'error': 'Use a JPG, PNG, WEBP, or PDF identity document'}), 400
        if identity_document_type not in {'campus_id', 'government_id', 'cor'}:
            return jsonify({'error': 'Select a supported identity document type'}), 400
        proof_bytes = proof.read()
        if len(proof_bytes) > MAX_IMAGE_BYTES:
            return jsonify({'error': 'Proof images must be 10 MB or smaller'}), 400
        identity_bytes = identity_document.read()
        if len(identity_bytes) > MAX_IMAGE_BYTES:
            return jsonify({'error': 'Identity documents must be 10 MB or smaller'}), 400
        if not _has_valid_signature(proof_bytes, proof.mimetype):
            return jsonify({'error': 'Ownership proof file content does not match its file type'}), 400
        if not _has_valid_signature(identity_bytes, identity_document.mimetype):
            return jsonify({'error': 'Identity document content does not match its file type'}), 400

        found_item = db.get_found_item_by_fpost_id(fpost_id)
        if not found_item:
            return jsonify({'error': 'Found item reference was not found'}), 404
        if str(found_item.get('status') or '').strip().lower() != 'unclaimed':
            return jsonify({'error': 'This found item is no longer accepting claims'}), 409
        if db.get_pending_claim(str(found_item['item_id']), account_id):
            return jsonify({'error': 'You already have a pending claim for this item'}), 409

        proof_filename = secure_filename(proof.filename) or 'claim-proof-image'
        proof_path = f"{account_id}/{uuid.uuid4().hex}-{proof_filename}"
        identity_filename = secure_filename(identity_document.filename) or 'identity-document'
        identity_path = f"{account_id}/{uuid.uuid4().hex}-{identity_filename}"
        proof_bucket = 'claim-proof-images'
        identity_bucket = 'claim-id-documents'
        try:
            db.client.storage.from_(proof_bucket).upload(proof_path, proof_bytes, {'content-type': proof.mimetype, 'upsert': 'false'})
            db.client.storage.from_(identity_bucket).upload(
                identity_path,
                identity_bytes,
                {'content-type': identity_document.mimetype, 'upsert': 'false'},
            )
            claim = db.create_claim({
                'found_item_id': found_item['item_id'],
                'claimant_account_id': account_id,
                'claim_reason': claim_reason,
                'proof_image_path': proof_path,
                'identity_document_path': identity_path,
                'identity_document_type': identity_document_type,
                'identity_document_name': identity_filename,
                'status': 'pending',
            })
        except Exception:
            for bucket_name, uploaded_path in ((identity_bucket, identity_path), (proof_bucket, proof_path)):
                try:
                    db.client.storage.from_(bucket_name).remove([uploaded_path])
                except Exception:
                    current_app.logger.warning('Unable to clean up an incomplete claim upload')
            raise
        claimant = db.get_user_by_account_id(account_id)
        user_full_name = f"{claimant.get('fname', '') if claimant else ''} {claimant.get('lname', '') if claimant else ''}".strip() or 'User'
        db.log_user_activity(
            account_id=account_id,
            user_name=user_full_name,
            action='Submit Claim',
            module='Claims & Verification',
            target_name=f"{found_item.get('fpost_id', '')} — {found_item.get('item_name', 'Item')}",
            target_id=found_item.get('fpost_id', ''),
            result='success'
        )
        claim_reference = claim.get('claim_reference') or claim.get('claim_id')
        email_sent = send_reference_email_best_effort(
            to_email=claimant.get('email') if claimant else None,
            recipient_name=user_full_name,
            subject='Your E-Balik claim was received',
            summary='Your claim was submitted successfully and is awaiting administrator review. Online approval does not release the item; bring your original ID for in-person verification.',
            reference_label='Claim reference',
            reference=str(claim_reference or 'Unavailable'),
            details={
                'Found item': found_item.get('item_name') or 'Found item',
                'Found item reference': found_item.get('fpost_id') or fpost_id,
            },
        )
        if not email_sent:
            current_app.logger.warning('Claim %s was saved, but confirmation email was not sent', claim_reference)
        claim_response = dict(claim)
        claim_response.pop('identity_document_path', None)
        claim_response.pop('proof_image_path', None)
        claim_response['proof_image_url'] = _signed_url(db, proof_bucket, proof_path)
        claim_response['identity_document_url'] = _signed_url(db, identity_bucket, identity_path)
        return jsonify({'message': 'Claim submitted and awaiting administrator review', 'claim': claim_response}), 201
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.exception('Claim request error')
        if current_app.config.get('DEBUG'):
            return jsonify({'error': 'Unable to process claim request', 'details': str(error)}), 500
        return jsonify({'error': 'Unable to process claim request'}), 500


@claims_bp.route('/<claim_id>', methods=['DELETE'])
def cancel_claim(claim_id):
    try:
        account_id = _account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if not db.cancel_claim(claim_id, account_id):
            return jsonify({'error': 'Pending claim not found or it is no longer cancellable'}), 404
        return jsonify({'message': 'Claim request cancelled'}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Claim cancellation error: {error}')
        return jsonify({'error': 'Unable to cancel claim request'}), 500