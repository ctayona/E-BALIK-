"""Found Item page: create found reports, list own reports, match summaries."""
import uuid
from datetime import datetime
from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename
from app.utils import custody_log, get_db
from app.utils.email_service import send_reference_email_best_effort
from app.utils.matching import build_found_match_summaries
from app.utils.report_guard import ReportRuleError, begin_submission, check_new_report, end_submission
from Users.Backend.shared.privacy import DPA_REQUIRED_MESSAGE, consent_metadata, dpa_consent_given
from Users.Backend.shared.request_auth import _authenticated_account_id, _public_url

found_item_bp = Blueprint('user_found_item', __name__)


def _active_guards(db):
    """Guard accounts that can receive an item. Includes the email so the guard can be told; routes must not return it."""
    rows = db.client.table('user_profiles').select('account_id,fname,lname,email,is_active').eq('access_level', 'guard').limit(200).execute().data or []
    return [row for row in rows if row.get('is_active') is not False]


def _full_name(profile):
    return f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip() or 'Guard'


@found_item_bp.route('/found-items/guards', methods=['GET'])
def list_guards():
    """The guards a finder can hand an item to: name only, never an email or campus ID."""
    try:
        _authenticated_account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        guards = sorted(({'id': str(row['account_id']), 'name': _full_name(row)} for row in _active_guards(db)), key=lambda guard: guard['name'].lower())
        return jsonify({'guards': guards}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Guard list error: {error}')
        return jsonify({'error': 'Unable to load the guards'}), 500


def _tell_guard(db, guard, item, fpost_id, item_name, turnover_location, finder_name):
    """Let the guard know an item was handed to them (in the app and by email). Best effort: the report is already saved."""
    try:
        db.create_user_notification(
            str(guard['account_id']), 'An item was handed to you',
            f'{finder_name or "A finder"} reported {item_name} ({fpost_id}) and says they turned it over to you at {turnover_location}. Please keep it safe for the Lost and Found Office.',
            found_item_id=item.get('item_id'), notification_type='guard_handover', link_label='Open release desk', link_page='guard-desk',
        )
    except Exception as error:
        current_app.logger.warning('Guard notification for %s failed: %s', fpost_id, error)
    try:
        send_reference_email_best_effort(
            to_email=guard.get('email'),
            recipient_name=_full_name(guard),
            subject='An item was handed to you on E-Balik',
            summary='A finder reported that they turned an item over to you. Please keep it safe and give it to the Lost and Found Office.',
            reference_label='Found item reference',
            reference=fpost_id,
            details={'Item': item_name, 'Turned in at': turnover_location},
        )
    except Exception as error:
        current_app.logger.warning('Guard email for %s failed: %s', fpost_id, error)


@found_item_bp.route('/found-items', methods=['POST'])
def create_found_item():
    """Store a verified found-item turnover report for the authenticated user."""
    slot = None
    try:
        account_id = _authenticated_account_id()
        data = request.form

        item_name = str(data.get('item_name') or '').strip()
        location = str(data.get('location') or '').strip()
        category = str(data.get('category') or '').strip()
        description = str(data.get('description') or '').strip()
        found_date = str(data.get('found_date') or '').strip()
        turnover_location = str(data.get('turnover_location') or '').strip()
        guard_name_or_id = str(data.get('guard_name_or_id') or '').strip()
        handover_guard_id = str(data.get('handover_guard_id') or '').strip()

        if not item_name or not location or not category or not found_date or not turnover_location or not (guard_name_or_id or handover_guard_id):
            return jsonify({'error': 'Complete the item and security turnover details'}), 400
        if not dpa_consent_given(data):
            return jsonify({'error': DPA_REQUIRED_MESSAGE, 'code': 'dpa_required'}), 400

        try:
            datetime.strptime(found_date, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Found date must use YYYY-MM-DD format'}), 400

        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        reporter = db.get_user_by_account_id(account_id)
        if not reporter:
            return jsonify({'error': 'Authenticated account profile was not found'}), 401

        # The finder picks the guard who received the item; the readable name is stored from the guard's own profile, not from the form.
        guard = None
        if handover_guard_id:
            guard = next((row for row in _active_guards(db) if str(row['account_id']) == handover_guard_id), None)
            if not guard:
                return jsonify({'error': 'That guard is not available any more. Choose another guard.', 'code': 'guard_unavailable'}), 400
            guard_name_or_id = _full_name(guard)

        slot = begin_submission(f'found:{account_id}')
        check_new_report(
            {'item_name': item_name, 'description': description}, 'found',
            db.get_missing_items_by_account(account_id), db.get_found_items_by_account(account_id),
        )
        weekday_code = str(datetime.strptime(found_date, '%Y-%m-%d').weekday() + 1)
        fpost_id = db.next_fpost_id(found_date, weekday_code)

        image_url = None
        image = request.files.get('image')
        if image and image.filename:
            bucket_name = 'found-item-images'
            filename = secure_filename(image.filename)
            storage_path = f"{account_id}/{found_date}/{uuid.uuid4().hex}-{filename}"
            file_bytes = image.read()
            db.client.storage.from_(bucket_name).upload(
                storage_path,
                file_bytes,
                {'content-type': image.mimetype or 'application/octet-stream', 'upsert': 'false'}
            )
            image_url = _public_url(db.client.storage.from_(bucket_name).get_public_url(storage_path))

        item = db.create_found_item({
            'account_id': account_id,
            'fpost_id': fpost_id,
            'reporter_account_id': account_id,
            'reporter_email': reporter.get('email'),
            'reporter_campus_id': reporter.get('campus_id'),
            'item_name': item_name,
            'category': category,
            'description': description,
            'location': location,
            'found_date': found_date,
            'image_url': image_url,
            'turnover_location': turnover_location,
            'guard_name_or_id': guard_name_or_id,
            'handover_guard_id': str(guard['account_id']) if guard else None,
            'custody_status': 'turned_over',
            'status': 'unclaimed',
        })
        user_full_name = f"{reporter.get('fname', '')} {reporter.get('lname', '')}".strip()
        custody_log.record(db.client, item.get('item_id'), 'turned_over', account_id, user_full_name,
                           f"Found at {location}; handed to {guard_name_or_id} at {turnover_location}.")
        db.log_user_activity(
            account_id=account_id,
            user_name=user_full_name,
            action='Report Found Item',
            module='Found Items',
            target_name=f"{fpost_id} — {item_name}",
            target_id=fpost_id,
            result='success',
            metadata=consent_metadata(),
        )
        if guard:
            _tell_guard(db, guard, item, fpost_id, item_name, turnover_location, user_full_name)
        email_sent = send_reference_email_best_effort(
            to_email=reporter.get('email'),
            recipient_name=user_full_name,
            subject='Your E-Balik found-item report was received',
            summary='Thank you for turning in a found item. Keep this reference if administrators need to follow up about custody.',
            reference_label='Found item reference',
            reference=fpost_id,
            details={
                'Item': item_name,
                'Category': category,
                'Found location': location,
                'Found date': found_date,
                'Turned in at': turnover_location,
            },
        )
        if not email_sent:
            current_app.logger.warning('Found item %s was saved, but confirmation email was not sent', fpost_id)
        return jsonify({'message': 'Found item report created', 'item': item, 'fpost_id': fpost_id}), 201
    except ReportRuleError as error:
        return jsonify({'error': error.message, 'code': error.code, **error.extra}), error.status
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Found item creation error: {error}')
        return jsonify({'error': f'Unable to save found item report: {error}'}), 500
    finally:
        end_submission(slot)


@found_item_bp.route('/found-items', methods=['GET'])
def list_found_items():
    """List only reports made by the authenticated account."""
    try:
        account_id = _authenticated_account_id()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'items': db.get_found_items_by_account(account_id)}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Found item listing error: {error}')
        return jsonify({'error': 'Unable to load found item reports'}), 500


@found_item_bp.route('/found-items/matches', methods=['GET'])
def summarize_found_item_matches():
    """Summarize matching missing reports for the current user's found reports."""
    try:
        account_id = _authenticated_account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        found_items = db.get_found_items_by_account(account_id)
        missing_items = db.get_missing_items_for_matching()
        return jsonify({'summaries': build_found_match_summaries(found_items, missing_items)}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Found item match summary error: {error}')
        return jsonify({'error': 'Unable to load found item matches'}), 500
