"""My Reports page: owner-scoped edit and delete of found and missing reports."""
from flask import Blueprint, current_app, jsonify, request
from app.utils import get_db
from app.utils.report_dates import check_date
from app.utils.report_lifecycle import is_completed
from app.utils.text_guard import TextRejected, clean_field
from Users.Backend.shared.request_auth import _authenticated_account_id

my_reports_bp = Blueprint('user_my_reports', __name__)

COMPLETED_MESSAGE = 'This report is completed (the item was released), so it can no longer be changed or deleted.'


# field -> (kind, label, required). Only the fields the person actually sent are checked, so a partial edit still works.
FOUND_TEXT_FIELDS = {'item_name': ('title', 'item title', True), 'description': ('description', 'description', False), 'location': ('place', 'found location', True)}
MISSING_TEXT_FIELDS = {'item_name': ('title', 'item name', True), 'description': ('description', 'description', True),
                       'distinctive_marks': ('marks', 'distinguishing details', False), 'last_location': ('place', 'last seen location', True)}


DATE_FIELDS = {'found_date': 'date found', 'last_seen_date': 'last seen date'}


def _clean_edit(body, rules):
    """The edit with every text field stripped of markup and checked; raises TextRejected naming the field that failed."""
    cleaned = dict(body)
    for field, label in DATE_FIELDS.items():
        if cleaned.get(field) is not None:
            cleaned[field] = check_date(cleaned[field], field, label)
    for field, (kind, label, required) in rules.items():
        if cleaned.get(field) is not None:
            cleaned[field] = clean_field(cleaned[field], kind, field, label, required=required)
    return cleaned


def _refuse_completed(kind, report):
    if report and is_completed(kind, report.get('status')):
        return jsonify({'error': COMPLETED_MESSAGE, 'code': 'report_completed'}), 409
    return None


@my_reports_bp.route('/found-items/<fpost_id>', methods=['PUT', 'DELETE'])
def manage_found_item(fpost_id):
    try:
        account_id = _authenticated_account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        report = next((row for row in db.get_found_items_by_account(account_id) if str(row.get('fpost_id')) == fpost_id), None)
        refused = _refuse_completed('found', report)
        if refused:
            return refused
        if request.method == 'DELETE':
            if report and str(report.get('status') or '').strip().lower() == 'auctioned':
                return jsonify({'error': 'This item is in an auction, so the report cannot be deleted.', 'code': 'report_in_use'}), 409
            if report and db.client.table('claims').select('claim_id').eq('found_item_id', report['item_id']).limit(1).execute().data:
                # Deleting the report would delete the claims on it, and with them the record of who asked for the item.
                return jsonify({'error': 'Someone has claimed this item, so the report cannot be deleted. Contact the Lost and Found Office if it is a mistake.', 'code': 'report_in_use'}), 409
            return jsonify({'deleted': db.delete_found_item_by_account(fpost_id, account_id)}), 200
        item = db.update_found_item_by_account(fpost_id, account_id, _clean_edit(request.get_json(silent=True) or {}, FOUND_TEXT_FIELDS))
        if not item:
            return jsonify({'error': 'Report not found or not owned by this account'}), 404
        return jsonify({'item': item}), 200
    except TextRejected as error:
        return jsonify(error.body()), error.status
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Found item management error: {error}')
        return jsonify({'error': 'Unable to update found item report'}), 500


@my_reports_bp.route('/missing-items/<mpost_id>', methods=['PUT', 'DELETE'])
def manage_missing_item(mpost_id):
    try:
        account_id = _authenticated_account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        report = next((row for row in db.get_missing_items_by_account(account_id) if str(row.get('mpost_id')) == mpost_id), None)
        refused = _refuse_completed('missing', report)
        if refused:
            return refused
        if request.method == 'DELETE':
            return jsonify({'deleted': db.delete_missing_item_by_account(mpost_id, account_id)}), 200
        item = db.update_missing_item_by_account(mpost_id, account_id, _clean_edit(request.get_json(silent=True) or {}, MISSING_TEXT_FIELDS))
        if not item:
            return jsonify({'error': 'Report not found or not owned by this account'}), 404
        return jsonify({'item': item}), 200
    except TextRejected as error:
        return jsonify(error.body()), error.status
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Missing item management error: {error}')
        return jsonify({'error': 'Unable to update missing item report'}), 500
