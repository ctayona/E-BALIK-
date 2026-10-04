"""Found Item page: create found reports, list own reports, match summaries."""
import uuid
from datetime import datetime
from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename
from app.utils import get_db
from app.utils.email_service import send_reference_email_best_effort
from app.utils.matching import build_found_match_summaries
from Users.Backend.shared.request_auth import _authenticated_account_id, _public_url

found_item_bp = Blueprint('user_found_item', __name__)


@found_item_bp.route('/found-items', methods=['POST'])
def create_found_item():
    """Store a verified found-item turnover report for the authenticated user."""
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

        if not item_name or not location or not category or not found_date or not turnover_location or not guard_name_or_id:
            return jsonify({'error': 'Complete the item and security turnover details'}), 400

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
            'custody_status': 'turned_over',
            'status': 'unclaimed',
        })
        user_full_name = f"{reporter.get('fname', '')} {reporter.get('lname', '')}".strip()
        db.log_user_activity(
            account_id=account_id,
            user_name=user_full_name,
            action='Report Found Item',
            module='Found Items',
            target_name=f"{fpost_id} — {item_name}",
            target_id=fpost_id,
            result='success'
        )
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
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.error(f'Found item creation error: {error}')
        return jsonify({'error': f'Unable to save found item report: {error}'}), 500


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
