"""Claim page: submit, list and cancel claims."""
from flask import Blueprint, Response, current_app, jsonify, request
from werkzeug.utils import secure_filename
import uuid

from app.utils import JWTService, get_db
from app.utils.email_service import send_reference_email_best_effort
from app.utils.handover import HandoverService, qr_png
from app.utils.report_guard import ReportRuleError, begin_submission, end_submission
from Users.Backend.shared.privacy import DPA_REQUIRED_MESSAGE, consent_metadata, dpa_consent_given
from Users.Backend.shared.uploads import has_valid_signature

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


_has_valid_signature = has_valid_signature


@claims_bp.route('', methods=['GET', 'POST'])
def claims():
    slot = None
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
        if not dpa_consent_given(request.form):
            return jsonify({'error': DPA_REQUIRED_MESSAGE, 'code': 'dpa_required'}), 400
        # One submission per account and item at a time: a double-click must never create two claims.
        slot = begin_submission(f'claim:{account_id}:{fpost_id.lower()}')
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
        # Optional: which of the claimant's own lost reports this item is. It is completed together with the claim once the item is collected.
        missing_report_ref = str(request.form.get('missing_report_id') or '').strip()
        missing_report_uuid = None
        if missing_report_ref:
            own_report = next((r for r in db.get_missing_items_by_account(account_id) if str(r.get('mpost_id')) == missing_report_ref), None)
            if not own_report or str(own_report.get('status') or '').strip().lower() not in ('missing', 'found', 'open'):
                return jsonify({'error': 'Choose one of your own lost reports that is still open, or leave it empty.', 'code': 'invalid_missing_report'}), 400
            missing_report_uuid = own_report['item_id']

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
            claim_row = {
                'found_item_id': found_item['item_id'],
                'claimant_account_id': account_id,
                'claim_reason': claim_reason,
                'proof_image_path': proof_path,
                'identity_document_path': identity_path,
                'identity_document_type': identity_document_type,
                'identity_document_name': identity_filename,
                'status': 'pending',
            }
            if missing_report_uuid:
                claim_row['missing_report_id'] = missing_report_uuid
            claim = db.create_claim(claim_row)
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
            result='success',
            metadata=consent_metadata(),
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
        auction_notice = None
        try:
            if db.client.table('auctions').select('auction_id').eq('found_item_id', found_item['item_id']).in_('status', ['scheduled', 'active', 'awaiting_admin']).limit(1).execute().data:
                auction_notice = 'This item is in an auction right now. If an administrator approves your claim, the auction is cancelled and the item goes back to you.'
        except Exception:
            auction_notice = None
        claim_response.pop('identity_document_path', None)
        claim_response.pop('proof_image_path', None)
        claim_response['proof_image_url'] = _signed_url(db, proof_bucket, proof_path)
        claim_response['identity_document_url'] = _signed_url(db, identity_bucket, identity_path)
        return jsonify({'message': 'Claim submitted and awaiting administrator review', 'claim': claim_response, 'auction_notice': auction_notice}), 201
    except ReportRuleError as error:
        return jsonify({'error': 'You already submitted a claim for this item a moment ago.' if error.code == 'duplicate_submission' else error.message, 'code': error.code}), error.status
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        if 'duplicate key' in str(error).lower() or 'uq_claims_open' in str(error):
            return jsonify({'error': 'You already have an open claim for this item', 'code': 'duplicate_claim'}), 409
        current_app.logger.exception('Claim request error')
        if current_app.config.get('DEBUG'):
            return jsonify({'error': 'Unable to process claim request', 'details': str(error)}), 500
        return jsonify({'error': 'Unable to process claim request'}), 500
    finally:
        end_submission(slot)


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


@claims_bp.route('/<claim_id>/handover-qr', methods=['GET'])
def handover_qr(claim_id):
    """The signed-in claimant's own Handover PIN as a QR code, for the guard to scan. Never cached, and only for the claim's owner."""
    try:
        account_id = _account_id()
        try:
            uuid.UUID(str(claim_id))
        except ValueError:
            return jsonify({'error': 'Claim not found'}), 404
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        rows = db.client.table('claims').select('claim_id,status,claimant_account_id,handover_pin_encrypted').eq('claim_id', claim_id) \
            .eq('claimant_account_id', account_id).limit(1).execute().data or []
        pin = HandoverService(db).reveal(rows[0]) if rows else None
        if not pin:
            return jsonify({'error': 'There is no active Handover PIN for this claim.'}), 404
        response = Response(qr_png(pin), mimetype='image/png')
        response.headers['Cache-Control'] = 'no-store'
        return response
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.exception('Handover QR failed for claim_id=%s: %s', claim_id, error)
        return jsonify({'error': 'Unable to create the QR code'}), 500
