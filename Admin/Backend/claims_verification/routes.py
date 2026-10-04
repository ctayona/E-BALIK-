"""Claims Verification page: claim queue, history, status changes and deletion."""
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.claim_status import normalize_claim_status
from app.utils.email_service import send_reference_email_best_effort
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
            'message': 'Claim deleted and recorded in claim history.',
        }), 200
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
        if status == 'approved_for_pickup' and claim_email_context:
            email_sent = send_reference_email_best_effort(
                to_email=claim_email_context.get('email'),
                recipient_name=claim_email_context.get('name') or 'there',
                subject='Your E-Balik claim was approved',
                summary='Your claim was approved for office verification. Bring your original ID and this claim reference when collecting the item. Online approval does not release the item.',
                reference_label='Approved claim reference',
                reference=str(claim_email_context.get('claim_reference') or claim_id),
                details={
                    'Found item': claim_email_context.get('item_name') or 'Found item',
                    'Found item reference': claim_email_context.get('found_item_reference') or '',
                    'Next step': 'Visit the UMAK Lost and Found Office for in-person verification.',
                },
            )
            if not email_sent:
                current_app.logger.warning('Claim %s was approved, but approval email was not sent', claim_id)
        return jsonify({'claim': updated}), 200
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
