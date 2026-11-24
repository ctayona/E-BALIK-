"""Archive and restore admin records while preserving their operational state."""
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.archive import KINDS, ArchiveError, set_archived, archived_keys
from app.utils.auction_db import AuctionError, AuctionService, AuctionsUnavailable
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

archive_bp = Blueprint('admin_archive', __name__)

PAGES = {'lost': 'Lost Items', 'found': 'Found Items', 'claim': 'Claims & Verification', 'auction': 'Auctions', 'user': 'Users', 'tag': 'Smart Tags', 'tag_batch': 'Smart Tags'}


@archive_bp.route('/archive', methods=['POST'])
def archive_record():
    try:
        admin = _require_admin()
        payload = request.get_json(silent=True) or {}
        kind = str(payload.get('kind') or '').strip().lower()
        if kind in ('user', 'tag', 'tag_batch'):
            admin = _require_admin('super_admin')
        reference = str(payload.get('reference') or '').strip()
        archived = payload.get('archived', True) is not False
        if kind not in PAGES:
            return jsonify({'error': 'Choose what to archive.', 'code': 'unknown_kind'}), 400
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if kind == 'user' and reference == admin['account_id']:
            raise ArchiveError('You cannot archive your own account.', 403)
        if kind == 'tag_batch':
            rows = db.client.table('smart_tags').select('status,is_disabled').eq('batch_id', reference).limit(5000).execute().data or []
            if archived and any(row.get('status') != 'blank' and not row.get('is_disabled') for row in rows):
                raise ArchiveError('Deactivate registered tags before archiving their batch.', 409)
            result = {'count': db.client.rpc('admin_archive_tag_batch', {'p_batch': reference, 'p_actor': admin['account_id'], 'p_archived': archived}).execute().data}
        elif kind == 'auction':
            result = AuctionService(db).set_archived(reference, admin['account_id'], archived)
        else:
            result = set_archived(db.client, kind, reference, admin['account_id'], archived)
        _log_admin_action(db, admin, 'Archive Record' if archived else 'Restore From Archive', PAGES[kind], reference, reference)
        label = KINDS[kind]['label'] if kind in KINDS else 'tag batch' if kind == 'tag_batch' else 'auction'
        return jsonify({'success': True, **result, 'message': f"The {label} was {'archived' if archived else 'restored from the archive'}."}), 200
    except ArchiveError as error:
        return jsonify({'error': error.message, 'code': error.code}), error.status
    except AuctionError as error:
        return jsonify({'error': error.message, **error.extra}), error.status
    except AuctionsUnavailable as error:
        return jsonify({'error': str(error), 'setup_required': True}), 503
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Archive request failed: %s', error)
        return jsonify({'error': 'Unable to update the archive'}), 500


@archive_bp.get('/archive/status/<kind>')
def archive_status(kind):
    try:
        _require_admin()
        if kind not in KINDS:
            return jsonify(error='Unknown archive kind'), 400
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        spec = KINDS[kind]
        return jsonify(references=sorted(archived_keys(db.client, spec['table'], spec['key'])))
    except (ValueError, PermissionError):
        return jsonify(error='Administrator access required'), 403
