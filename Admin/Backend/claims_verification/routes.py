"""Claims Verification page: claim queue, history, status changes and deletion."""
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.claim_status import normalize_claim_status
from app.utils import housekeeping, rate_limit
from app.utils.email_service import EmailService
from app.utils.handover import HandoverError, HandoverService
from app.utils.recycle_bin import BinError, retention_days
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

claims_verification_bp = Blueprint('admin_claims_verification', __name__)


@claims_verification_bp.route('/claims', methods=['GET'])
def list_claims():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'claims': db.list_admin_claims()}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Admin claims listing error: {error}')
        return jsonify({'error': 'Unable to load claims'}), 500


@claims_verification_bp.route('/claims/history', methods=['GET'])
def list_claim_history():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'history': db.list_admin_claim_history()}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin claim history listing error: %s', error)
        return jsonify({'error': 'Unable to load claim history'}), 500


@claims_verification_bp.route('/claims/<claim_id>', methods=['DELETE'])
def delete_claim(claim_id):
    try:
        admin = _require_admin(required_level='super_admin')
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        deleted = db.delete_admin_claim(claim_id, admin['account_id'])
        _log_admin_action(db, admin, 'Delete Claim', 'Claims & Verification', deleted.get('claim_reference') or claim_id, claim_id)
        return jsonify({
            'success': True,
            'claim_reference': deleted.get('claim_reference'),
            'message': 'Claim moved to the Recycle bin and recorded in claim history. A super admin can restore it for the next %d days.' % retention_days(),
        }), 200
    except BinError as error:
        return jsonify({'error': error.message, 'code': error.code}), error.status
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Superadmin claim deletion failed for claim_id=%s: %s', claim_id, error)
        return jsonify({'error': 'Unable to delete claim', 'details': str(error)}), 500


@claims_verification_bp.route('/claims/<claim_id>/status', methods=['PATCH'])
def update_claim_status(claim_id):
    try:
        admin = _require_admin()
        payload = request.get_json(silent=True) or {}
        status = normalize_claim_status(payload.get('status'))
        if status not in {'approved_for_pickup', 'rejected', 'collected'}:
            return jsonify({'error': 'Status must be approved_for_pickup, rejected, or collected'}), 400

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        claim_email_context = db.get_claim_email_context(claim_id) if status == 'approved_for_pickup' else None
        updated = db.update_claim_status(claim_id, status, admin['account_id'], payload.get('rejection_reason'))
        _log_admin_action(db, admin, f'Claim {status.replace("_", " ").title()}', 'Claims & Verification', claim_id, claim_id)
        handover = {'handover_pin_issued': False, 'approval_email_sent': False}
        if status == 'approved_for_pickup' and claim_email_context:
            handover = _issue_pin_and_notify(db, claim_id, claim_email_context, new_deadline=True)
        if status == 'collected':
            _send_receipt(db, claim_id)
        return jsonify({'claim': updated, **handover}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except RuntimeError as error:
        message = str(error)
        if 'Approved claims can only be marked collected' in message or 'already closed' in message:
            return jsonify({'error': 'This claim has already been approved and can only be marked collected.'}), 409
        current_app.logger.exception('Admin claim status error for claim_id=%s payload=%s: %s', claim_id, request.get_json(silent=True), error)
        return jsonify({'error': 'Unable to update claim status', 'details': message}), 500
    except Exception as error:
        current_app.logger.exception('Admin claim status error for claim_id=%s payload=%s: %s', claim_id, request.get_json(silent=True), error)
        return jsonify({'error': 'Unable to update claim status', 'details': str(error)}), 500


def _issue_pin_and_notify(db, claim_id, context, new_deadline=False):
    """Create the Handover PIN for a just-approved claim and email it. Neither step may undo the approval.

    `new_deadline` starts the pickup clock (on approval); a re-sent PIN keeps the existing deadline.
    """
    pin = None
    deadline_text = None
    try:
        service = HandoverService(db)
        pin = service.issue(claim_id)
        if new_deadline:
            deadline = service.set_pickup_deadline(claim_id, housekeeping.claim_pickup_days())
            deadline_text = housekeeping.format_date(deadline)
    except HandoverError as error:
        current_app.logger.warning('Claim %s approved without a Handover PIN: %s', claim_id, error.message)
    except Exception as error:
        current_app.logger.exception('Claim %s approved, but the Handover PIN could not be created: %s', claim_id, error)
    email_sent = False
    try:
        email_sent = EmailService().send_claim_approved_email(
            to_email=context.get('email'),
            recipient_name=context.get('name') or 'there',
            claim_reference=str(context.get('claim_reference') or claim_id),
            item_name=context.get('item_name') or 'Found item',
            found_item_reference=context.get('found_item_reference') or '',
            handover_pin=pin,
            pickup_deadline_text=deadline_text,
        )
    except Exception as error:
        current_app.logger.exception('Claim %s approval email failed: %s', claim_id, error)
    if not email_sent:
        current_app.logger.warning('Claim %s was approved, but approval email was not sent', claim_id)
    return {'handover_pin_issued': bool(pin), 'approval_email_sent': bool(email_sent)}


def _send_receipt(db, claim_id):
    """Email the owner that the item was released. Best effort: the release is already recorded."""
    try:
        context = db.get_claim_email_context(claim_id) or {}
        if not context.get('email'):
            return False
        return bool(EmailService().send_handover_receipt_email(
            to_email=context['email'], recipient_name=context.get('name') or 'there', item_name=context.get('item_name') or 'Found item',
            claim_reference=str(context.get('claim_reference') or claim_id), found_item_reference=context.get('found_item_reference') or '',
            released_at=housekeeping.format_datetime(None),
        ))
    except Exception as error:
        current_app.logger.warning('Claim %s was released, but the receipt email was not sent: %s', claim_id, error)
        return False


def _handover_error(error):
    return jsonify({'error': error.message, 'code': error.code}), error.status


@claims_verification_bp.route('/claims/handover/lookup', methods=['POST'])
def handover_lookup():
    """The guard types the claimant's PIN; this shows who and what it belongs to before anything is released."""
    try:
        admin = _require_admin(required_level='guard')
        if not rate_limit.allow(f"handover:{admin['account_id']}", 12, 60):
            return jsonify({'error': 'Too many PIN attempts. Wait a minute and try again.', 'code': 'rate_limited'}), 429
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        found = HandoverService(db).find((request.get_json(silent=True) or {}).get('pin'))
        return jsonify({'claim': found}), 200
    except HandoverError as error:
        return _handover_error(error)
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Handover PIN lookup failed: %s', error)
        return jsonify({'error': 'Unable to check that PIN'}), 500


@claims_verification_bp.route('/claims/handover/release', methods=['POST'])
def handover_release():
    """Complete the physical handover: the item is released to its owner and the claim closes as collected."""
    try:
        admin = _require_admin(required_level='guard')
        if not rate_limit.allow(f"handover:{admin['account_id']}", 12, 60):
            return jsonify({'error': 'Too many PIN attempts. Wait a minute and try again.', 'code': 'rate_limited'}), 429
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        released = HandoverService(db).release((request.get_json(silent=True) or {}).get('pin'), admin['account_id'])
        _send_receipt(db, released['claim_id'])
        _log_admin_action(db, admin, 'Release Item By Handover PIN', 'Claims & Verification', released.get('claim_reference') or released['claim_id'], released['claim_id'])
        return jsonify({'success': True, 'claim': released, 'message': f"{released['item_name']} was released to {released['claimant_name']}."}), 200
    except HandoverError as error:
        return _handover_error(error)
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Handover release failed: %s', error)
        return jsonify({'error': 'Unable to release the item'}), 500


@claims_verification_bp.route('/claims/<claim_id>/handover-pin', methods=['POST'])
def reissue_handover_pin(claim_id):
    """Create a new PIN for an approved claim (claims approved before PINs existed, or a lost email) and email it."""
    try:
        admin = _require_admin()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        context = db.get_claim_email_context(claim_id)
        if not context:
            return jsonify({'error': 'Claim not found'}), 404
        result = _issue_pin_and_notify(db, claim_id, context)
        if not result['handover_pin_issued']:
            return jsonify({'error': 'A PIN can only be created for an approved claim, after the PIN migration has been run.'}), 409
        _log_admin_action(db, admin, 'Reissue Handover PIN', 'Claims & Verification', claim_id, claim_id)
        return jsonify({'success': True, **result}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Handover PIN reissue failed for claim_id=%s: %s', claim_id, error)
        return jsonify({'error': 'Unable to create a new PIN'}), 500


CLOSED_FOUND_ITEM_STATUSES = {'claimed', 'returned', 'closed', 'collected', 'disposed', 'auctioned'}
MAX_CLAIM_REASON_LENGTH = 2000


@claims_verification_bp.route('/claims', methods=['POST'])
def create_claim_record():
    """Record a walk-in claim on behalf of a registered claimant (admins and super admins)."""
    try:
        admin = _require_admin()
        payload = request.get_json(silent=True) or {}
        reference = str(payload.get('found_item_reference') or '').strip()
        claimant_identifier = str(payload.get('claimant') or '').strip()
        claim_reason = str(payload.get('claim_reason') or '').strip()
        verified_in_person = payload.get('verified_in_person') is True

        if not reference or not claimant_identifier or not claim_reason:
            return jsonify({'error': 'Found item reference, claimant email or campus ID, and claim reason are required'}), 400
        if len(claim_reason) > MAX_CLAIM_REASON_LENGTH:
            return jsonify({'error': f'Claim reason must be {MAX_CLAIM_REASON_LENGTH} characters or fewer'}), 400

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        found_item = db.get_found_item_by_fpost_id(reference)
        if not found_item:
            return jsonify({'error': f'No found item matches reference {reference}'}), 404
        if str(found_item.get('status') or '').lower() in CLOSED_FOUND_ITEM_STATUSES:
            return jsonify({'error': 'This found item is already closed and can no longer be claimed'}), 409

        claimant = db.get_user_by_email(claimant_identifier.lower()) if '@' in claimant_identifier else db.get_user_by_campus_id(claimant_identifier)
        if not claimant:
            return jsonify({'error': 'No registered account matches that email or campus ID'}), 404
        if claimant.get('is_active') is False:
            return jsonify({'error': 'That account is suspended and cannot submit claims'}), 409

        existing = db.find_open_claim(found_item['item_id'], claimant['account_id'])
        if existing:
            return jsonify({'error': f"This claimant already has an open claim for this item ({existing.get('claim_reference') or existing.get('claim_id')})"}), 409

        claim = db.create_claim({
            'found_item_id': found_item['item_id'],
            'claimant_account_id': claimant['account_id'],
            'claim_reason': claim_reason,
            'identity_document_type': 'verified_in_person' if verified_in_person else None,
            'status': 'pending',
        })
        _log_admin_action(db, admin, 'Record Walk-in Claim', 'Claims & Verification', claim.get('claim_reference') or reference, claim.get('claim_id') or reference)
        try:
            db.create_user_notification(
                claimant['account_id'],
                'A claim was recorded for you',
                f"The Lost and Found Office recorded your claim for {found_item.get('item_name') or 'a found item'} ({reference}). It is now pending review.",
                found_item_id=found_item.get('item_id'),
                notification_type='claim_update',
                link_label='View my claims',
                link_page='claim',
            )
        except Exception as notify_error:
            current_app.logger.warning('Walk-in claim %s recorded but claimant notification failed: %s', claim.get('claim_id'), notify_error)
        return jsonify({'claim': claim, 'message': f"Claim {claim.get('claim_reference') or ''} recorded for {claimant.get('email')}".strip()}), 201
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin walk-in claim error: %s', error)
        return jsonify({'error': 'Unable to record the claim'}), 500


@claims_verification_bp.route('/claims/<claim_id>', methods=['PATCH'])
def update_claim_details(claim_id):
    """Edit the reason of an open claim (admins and super admins). Status changes use /status."""
    try:
        admin = _require_admin()
        payload = request.get_json(silent=True) or {}
        claim_reason = str(payload.get('claim_reason') or '').strip()
        if not claim_reason:
            return jsonify({'error': 'Claim reason is required'}), 400
        if len(claim_reason) > MAX_CLAIM_REASON_LENGTH:
            return jsonify({'error': f'Claim reason must be {MAX_CLAIM_REASON_LENGTH} characters or fewer'}), 400

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        updated = db.update_claim_details(claim_id, claim_reason)
        if not updated:
            return jsonify({'error': 'Only open (pending or approved) claims can be edited'}), 409
        _log_admin_action(db, admin, 'Edit Claim Details', 'Claims & Verification', updated.get('claim_reference') or claim_id, claim_id)
        return jsonify({'claim': updated, 'message': 'Claim details updated'}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin claim edit error for %s: %s', claim_id, error)
        return jsonify({'error': 'Unable to update the claim'}), 500
