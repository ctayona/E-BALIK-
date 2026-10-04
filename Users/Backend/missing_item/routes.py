"""Missing Item page: create missing reports, list own reports, match summaries."""
import uuid
from datetime import datetime
from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename
from app.utils import get_db
from app.utils.email_service import send_reference_email_best_effort
from app.utils.matching import build_match_summaries
from Users.Backend.shared.request_auth import _authenticated_account_id, _public_url

missing_item_bp = Blueprint('user_missing_item', __name__)
ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def _weekday_code(date_value: str) -> str:
    return str(datetime.strptime(date_value, '%Y-%m-%d').weekday() + 1)


@missing_item_bp.route('/missing-items', methods=['POST'])
def create_missing_item():
    """Create a missing-item report owned by the authenticated account."""
    uploaded_path = None
    try:
        account_id = _authenticated_account_id()
        data = request.form
        item_name = str(data.get('item_name') or '').strip()
        category = str(data.get('category') or '').strip()
        description = str(data.get('description') or '').strip()
        distinctive_marks = str(data.get('distinctive_marks') or '').strip()
        last_location = str(data.get('last_location') or '').strip()
        last_seen_date = str(data.get('last_seen_date') or '').strip()
        authorized = str(data.get('authorized') or '').lower() == 'true'

        if not item_name or not category or not description or not last_location or not last_seen_date:
            return jsonify({'error': 'Complete the item name, category, description, location, and date'}), 400
        if not authorized:
            return jsonify({'error': 'You must authorize matching and notifications before submitting'}), 400
        try:
            datetime.strptime(last_seen_date, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Last seen date must use YYYY-MM-DD format'}), 400

        image_url = None
        image = request.files.get('image')
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        reporter = db.get_user_by_account_id(account_id)
        if not reporter:
            return jsonify({'error': 'Authenticated account profile was not found'}), 401

        if image and image.filename:
            if image.mimetype not in ALLOWED_IMAGE_TYPES:
                return jsonify({'error': 'Use a JPG, PNG, WEBP, or GIF image'}), 400
            file_bytes = image.read()
            if len(file_bytes) > MAX_IMAGE_BYTES:
                return jsonify({'error': 'Images must be 10 MB or smaller'}), 400
            filename = secure_filename(image.filename) or 'missing-item-image'
            uploaded_path = f"{account_id}/{last_seen_date}/{uuid.uuid4().hex}-{filename}"
            bucket_name = 'missing-item-images'
            try:
                db.client.storage.from_(bucket_name).upload(
                    uploaded_path,
                    file_bytes,
                    {'content-type': image.mimetype, 'upsert': 'false'},
                )
                image_url = _public_url(db.client.storage.from_(bucket_name).get_public_url(uploaded_path))
            except Exception as upload_error:
                current_app.logger.warning(f'Missing-item image upload skipped: {upload_error}')
                image_url = None

        mpost_id = db.next_mpost_id(last_seen_date, _weekday_code(last_seen_date))
        item = db.create_missing_item({
            'account_id': account_id,
            'mpost_id': mpost_id,
            'reporter_account_id': account_id,
            'reporter_email': reporter.get('email'),
            'reporter_campus_id': reporter.get('campus_id'),
            'item_name': item_name,
            'category': category,
            'description': description,
            'distinctive_marks': distinctive_marks,
            'last_location': last_location,
            'last_seen_date': last_seen_date,
            'image_url': image_url,
            'status': 'missing',
        })
        user_full_name = f"{reporter.get('fname', '')} {reporter.get('lname', '')}".strip()
        db.log_user_activity(
            account_id=account_id,
            user_name=user_full_name,
            action='Report Missing Item',
            module='Lost Items',
            target_name=f"{mpost_id} — {item_name}",
            target_id=mpost_id,
            result='success'
        )
        email_sent = send_reference_email_best_effort(
            to_email=reporter.get('email'),
            recipient_name=user_full_name,
            subject='Your E-Balik missing-item report was received',
            summary='We received your missing-item report. Keep this reference for tracking and future follow-up.',
            reference_label='Missing report reference',
            reference=mpost_id,
            details={
                'Item': item_name,
                'Category': category,
                'Last seen location': last_location,
                'Last seen date': last_seen_date,
            },
        )
        if not email_sent:
            current_app.logger.warning('Missing report %s was saved, but confirmation email was not sent', mpost_id)
        return jsonify({'message': 'Missing item report created', 'item': item, 'mpost_id': mpost_id}), 201
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.exception(f'Missing item creation error: {error}')
        response = {'error': 'Unable to save missing item report'}
        if current_app.debug:
            response['details'] = str(error)
        return jsonify(response), 500


@missing_item_bp.route('/missing-items', methods=['GET'])
def list_missing_items():
    """List only reports created by the authenticated account."""
    try:
        account_id = _authenticated_account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        return jsonify({'items': db.get_missing_items_by_account(account_id)}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Missing item listing error: {error}')
        return jsonify({'error': 'Unable to load missing item reports'}), 500


@missing_item_bp.route('/missing-items/matches', methods=['GET'])
def summarize_missing_item_matches():
    """Summarize matching found reports for the current user's missing reports."""
    try:
        account_id = _authenticated_account_id()
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        missing_items = db.get_missing_items_by_account(account_id)
        found_items = db.get_unclaimed_found_items_for_matching()
        return jsonify({'summaries': build_match_summaries(missing_items, found_items)}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Missing item match summary error: {error}')
        return jsonify({'error': 'Unable to load missing item matches'}), 500
