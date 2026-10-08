"""Email notification preferences: the signed-in user's choices, and the one-click unsubscribe link used in emails."""
from html import escape

from flask import Blueprint, Response, current_app, jsonify, request

from app.utils import JWTService, email_prefs, get_db

email_prefs_bp = Blueprint('email_prefs', __name__)

DESCRIPTIONS = {
    'reminders': 'Reminders: pickup reminders for approved claims and Smart Tag expiry reminders.',
    'announcements': 'Announcements: messages the administrators send to everyone.',
    'admin_digest': 'Daily summary: what is waiting for an administrator (staff only).',
}


def _db():
    return get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])


def _account_id():
    token = JWTService.extract_token_from_header(request.headers.get('Authorization', ''))
    return JWTService.verify_token(token).get('account_id')


def _read_prefs_row(db, account_id):
    """(profile row, True) or (None, False) when the preferences column has not been created yet."""
    try:
        rows = db.client.table('user_profiles').select('account_id,email_preferences').eq('account_id', account_id).limit(1).execute().data or []
        return (rows[0] if rows else {}), True
    except Exception:
        return None, False


@email_prefs_bp.route('/preferences', methods=['GET'])
def get_preferences():
    try:
        account_id = _account_id()
        row, available = _read_prefs_row(_db(), account_id)
        return jsonify({'preferences': email_prefs.get_prefs(row), 'staff': email_prefs.staff_prefs(row), 'available': available, 'descriptions': DESCRIPTIONS}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.exception('Email preferences read failed: %s', error)
        return jsonify({'error': 'Unable to load your email preferences'}), 500


@email_prefs_bp.route('/preferences', methods=['PUT'])
def save_preferences():
    try:
        account_id = _account_id()
        changes = email_prefs.clean_update(request.get_json(silent=True))
        if not changes:
            return jsonify({'error': 'Send reminders, announcements and/or admin_digest as true or false.'}), 400
        db = _db()
        row, available = _read_prefs_row(db, account_id)
        if not available:
            return jsonify({'error': 'Notification preferences are not set up yet. Ask an administrator to run migration 20261013.', 'setup_required': True}), 503
        merged = email_prefs.merged(row, changes)
        db.client.table('user_profiles').update({'email_preferences': merged}).eq('account_id', account_id).execute()
        return jsonify({'preferences': merged, 'staff': email_prefs.staff_prefs({'email_preferences': merged}), 'available': True}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except Exception as error:
        current_app.logger.exception('Email preferences save failed: %s', error)
        return jsonify({'error': 'Unable to save your email preferences'}), 500


# ------------------------------------------------------------------------------------------------ unsubscribe (no login)
def _page(title: str, body: str, status: int = 200) -> Response:
    html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{escape(title)}</title></head><body style="margin:0;background:#0b1430;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#eef1f8;">'
        '<div style="max-width:480px;margin:12vh auto;padding:32px;border:1px solid #34437a;border-radius:20px;background:#16224a;">'
        '<p style="margin:0;color:#d1a153;font-size:12px;letter-spacing:1.4px;">E-BALIK &middot; UNIVERSITY OF MAKATI</p>'
        f'<h1 style="margin:10px 0 14px;font-family:Georgia,serif;font-size:26px;">{escape(title)}</h1>{body}</div></body></html>'
    )
    response = Response(html, status=status, mimetype='text/html')
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Robots-Tag'] = 'noindex'
    return response


@email_prefs_bp.route('/unsubscribe', methods=['GET', 'POST'])
def unsubscribe():
    """GET shows a confirm button (mail scanners that open links must not unsubscribe anyone); POST, including a mail app's one-click, applies it."""
    token = request.args.get('t') or request.form.get('t')
    parsed = email_prefs.read_token(token)
    if not parsed:
        return _page('This link is not valid', '<p style="line-height:1.6;color:#b9c3dc;">The unsubscribe link is incomplete or was changed. You can manage your emails any time in E-Balik, under Profile.</p>', 400)
    account_id, category = parsed
    label = email_prefs.LABELS[category]
    if request.method == 'GET':
        return _page(
            f'Unsubscribe from {label}?',
            f'<p style="line-height:1.6;color:#b9c3dc;">You will stop getting {escape(label)} by email. Important messages, such as verification codes and claim approvals, are always sent.</p>'
            f'<form method="post" action="/api/email/unsubscribe?t={escape(str(token), quote=True)}"><button type="submit" style="margin-top:8px;padding:14px 22px;border:0;border-radius:12px;background:#d1a153;color:#0b1430;font-weight:700;font-size:16px;cursor:pointer;">Unsubscribe</button></form>',
        )
    try:
        db = _db()
        row, available = _read_prefs_row(db, account_id)
        if not available or row is None:
            return _page('Not available yet', '<p style="line-height:1.6;color:#b9c3dc;">We could not update your settings right now. Please try again later or change them in E-Balik, under Profile.</p>', 503)
        merged = email_prefs.merged(row, {category: False})
        db.client.table('user_profiles').update({'email_preferences': merged}).eq('account_id', account_id).execute()
    except Exception as error:
        current_app.logger.exception('Unsubscribe failed: %s', error)
        return _page('Something went wrong', '<p style="line-height:1.6;color:#b9c3dc;">We could not update your settings. Please try again later.</p>', 500)
    return _page('You are unsubscribed', f'<p style="line-height:1.6;color:#b9c3dc;">You will no longer get {escape(label)} by email. You can switch them back on any time in E-Balik, under Profile.</p>')
