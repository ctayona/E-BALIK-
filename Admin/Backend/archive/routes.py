"""Archive and restore finished records on the admin management pages (lost reports, found reports, claims, auctions).

One endpoint for every page: POST /api/admin/archive {kind: lost|found|claim|auction, reference, archived: true|false}.
Nothing is deleted. Any administrator may archive; only finished records qualify (see app/utils/archive.py).
"""
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.archive import KINDS, ArchiveError, set_archived
from app.utils.auction_db import AuctionError, AuctionService, AuctionsUnavailable
from Admin.Backend.shared.admin_access import _log_admin_action, _require_admin

archive_bp = Blueprint('admin_archive', __name__)

PAGES = {'lost': 'Lost Items', 'found': 'Found Items', 'claim': 'Claims & Verification', 'auction': 'Auctions'}


@archive_bp.route('/archive', methods=['POST'])
def archive_record():
    try:
        admin = _require_admin()
        payload = request.get_json(silent=True) or {}
        kind = str(payload.get('kind') or '').strip().lower()
        reference = str(payload.get('reference') or '').strip()
        archived = payload.get('archived', True) is not False
        if kind not in PAGES:
            return jsonify({'error': 'Choose what to archive.', 'code': 'unknown_kind'}), 400
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        if kind == 'auction':
            result = AuctionService(db).set_archived(reference, admin['account_id'], archived)
        else:
            result = set_archived(db.client, kind, reference, admin['account_id'], archived)
        _log_admin_action(db, admin, 'Archive Record' if archived else 'Restore From Archive', PAGES[kind], reference, reference)
        label = KINDS[kind]['label'] if kind in KINDS else 'auction'
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
