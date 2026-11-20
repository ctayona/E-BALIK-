"""Isolated attendee reporting and event desk. Assignments never grant campus roles."""
import io
import json
from functools import wraps
from datetime import datetime, timezone
from flask import Blueprint, current_app, jsonify, make_response, request, send_file
from app.utils import get_db, JWTService
from app.utils.events import EventError, EventFoundation
from app.utils.event_lifecycle import EventLifecycle, parse, usable_profile
from app.utils.system_control import access_level, effective_maintenance, DESK_LEVELS, DEFAULT_SETTINGS
from app.utils.event_reports import EventReports
from app.utils.event_recovery import EventRecovery
from app.utils.event_matching import EventMatching
from app.utils.event_alerts import EventAlerts
from app.utils.event_pilot import EventPilot
from app.utils.event_assets import MAX_BYTES
from app.utils import rate_limit

event_desk_bp = Blueprint('event_desk', __name__)


def _private(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        try:
            if current_app.config.get('EVENTS_FOUNDATION_ENABLED') is not True:
                raise EventError('Event workspaces are unavailable.', 503, 'events_disabled')
            if request.content_length and request.content_length > MAX_BYTES + 65536:
                raise EventError('Request is too large.', 413)
            payload = JWTService.verify_token(JWTService.extract_token_from_header(request.headers.get('Authorization', '')))
            issued = payload.get('iat')
            if isinstance(issued, bool) or not isinstance(issued, (int, float)):
                raise ValueError('Sign in again.')
            db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
            profile = db.get_user_by_account_id(payload.get('account_id'))
            if not usable_profile(profile, datetime.now(timezone.utc)):
                raise EventError('Active account access required.', 403, 'event_access_denied')
            # Fresh reads fail closed if session-revocation settings cannot be checked.
            settings = {key: dict(DEFAULT_SETTINGS[key]) for key in ('sessions_valid_after', 'role_session_wipes', 'maintenance_mode', 'maintenance_windows')}
            settings.update({r['setting_key']: r['setting_value'] for r in EventFoundation(db)._execute(db.client.table('system_settings').select('setting_key,setting_value').in_('setting_key', list(settings)))})
            level = access_level(profile)
            if effective_maintenance(settings)[0] and level not in DESK_LEVELS:
                raise EventError('E-Balik is under maintenance. Try again later.', 503, 'maintenance')
            cutoffs = [(settings.get('sessions_valid_after') or {}).get('ts'), ((settings.get('role_session_wipes') or {}).get(level) or {}).get('ts')]
            if any(stamp and issued < parse(stamp).timestamp() for stamp in cutoffs):
                response = make_response(jsonify(error='Your session was ended. Please sign in again.', session_revoked=True), 401)
                response.headers['Cache-Control'] = 'no-store'
                return response
            response = make_response(view(EventLifecycle(db), profile['account_id'], *args, **kwargs))
        except EventError as error:
            response = make_response(jsonify(error=str(error), code=error.code), error.status)
        except ValueError:
            response = make_response(jsonify(error='Please sign in again.'), 401)
        except Exception:
            current_app.logger.exception('Event desk authorization failed')
            response = make_response(jsonify(error='Unable to verify event access. Try again later.'), 503)
        response.headers['Cache-Control'] = 'no-store'
        return response
    return wrapped


@event_desk_bp.get('/mine')
@_private
def mine(service, account_id):
    members = service.events._execute(service.client.table('event_memberships').select('event_id').eq('account_id', account_id).eq('status', 'active').limit(100))
    workspaces = []
    for member in members:
        try:
            workspaces.append(EventReports(service.db).workspace(member['event_id'], account_id))
        except EventError as error:
            if error.status not in (403, 404):
                raise
    return jsonify(workspaces=workspaces), 200


@event_desk_bp.get('/<identifier>/workspace')
@_private
def workspace(service, account_id, identifier):
    return jsonify(EventReports(service.db).workspace(identifier, account_id)), 200


def _offset():
    value = request.args.get('offset', '0')
    if not value.isascii() or not value.isdigit() or len(value) > 6 or int(value) > 100000:
        raise EventError('Invalid event report page.')
    return int(value)


@event_desk_bp.get('/hub/publications')
@_private
def published_event_reports(service, account_id):
    return jsonify(EventPilot(service.db).hub(account_id, _offset(), request.args.get('kind', 'all'), request.args.get('search', ''))), 200


@event_desk_bp.get('/hub/publications/<publication_id>')
@_private
def published_event_report(service, account_id, publication_id):
    return jsonify(EventPilot(service.db).hub_detail(publication_id, account_id)), 200


@event_desk_bp.get('/portal/<slug>/recovery-info')
@_private
def event_recovery_instructions(service, account_id, slug):
    return jsonify(EventPilot(service.db).recovery_info(slug, account_id)), 200


@event_desk_bp.route('/<identifier>/reports/<report_id>/hub-consent', methods=['GET', 'POST'])
@_private
def own_hub_permission(service, account_id, identifier, report_id):
    pilot = EventPilot(service.db)
    if request.method == 'GET': return jsonify(pilot.own_consent(identifier, report_id, account_id)), 200
    if not rate_limit.allow(f'event-consent:{account_id}', 20, 60): raise EventError('Wait before changing hub permission again.', 429)
    return jsonify(pilot.consent(identifier, report_id, account_id, request.get_json(silent=True))), 200


@event_desk_bp.get('/<identifier>/operations')
@_private
def manager_event_summary(service, account_id, identifier):
    return jsonify(EventPilot(service.db).snapshot(identifier, account_id, _offset(), request.args.get('view', 'all'))), 200


@event_desk_bp.get('/<identifier>/operations/export')
@_private
def manager_event_export(service, account_id, identifier):
    if not rate_limit.allow(f'event-export:{account_id}', 5, 60): raise EventError('Wait before downloading another event export.', 429)
    data = EventPilot(service.db).export(identifier, account_id)
    response = make_response(data, 200); response.headers.update({'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="event-closing-register.zip"'})
    return response


@event_desk_bp.get('/custody/incoming')
@_private
def incoming_event_custody(service, account_id):
    return jsonify(EventPilot(service.db).incoming(account_id, _offset())), 200


@event_desk_bp.post('/<identifier>/custody/accept')
@_private
def accept_event_custody(service, account_id, identifier):
    if not rate_limit.allow(f'event-custody-accept:{account_id}', 20, 60): raise EventError('Wait before another handover receipt.', 429)
    return jsonify(EventPilot(service.db).accept(identifier, account_id, request.get_json(silent=True))), 200


def _create(service, identifier, account_id):
    if not rate_limit.allow(f'event-report:{account_id}:{identifier}', 10, 60):
        raise EventError('Too many report attempts. Wait a minute and try again.', 429)
    if request.is_json:
        payload, photo = request.get_json(silent=True), None
    else:
        if set(request.form) != {'payload'} or set(request.files) - {'photo'}:
            raise EventError('Invalid event report form.')
        try:
            payload = json.loads(request.form['payload'])
        except (TypeError, ValueError):
            raise EventError('Invalid event report form.') from None
        upload = request.files.get('photo')
        photo = upload.stream.read(MAX_BYTES + 1) if upload else None
    return jsonify(report=EventReports(service.db).create(identifier, payload, account_id, photo)), 201


@event_desk_bp.get('/portal/<slug>')
def portal(slug):
    try:
        if current_app.config.get('EVENTS_FOUNDATION_ENABLED') is not True:
            raise EventError('Event pages are unavailable.', 503, 'events_disabled')
        if not rate_limit.allow(f'event-portal:{request.remote_addr}', 120, 60):
            raise EventError('Please wait before refreshing again.', 429)
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        response = make_response(jsonify(EventReports(db).portal(slug)), 200)
    except EventError as error:
        response = make_response(jsonify(error=str(error), code=error.code), error.status)
    except Exception:
        current_app.logger.exception('Event portal unavailable')
        response = make_response(jsonify(error='Event page is temporarily unavailable.'), 503)
    response.headers['Cache-Control'] = 'no-store'
    return response


@event_desk_bp.route('/portal/<slug>/reports', methods=['GET', 'POST'])
@_private
def portal_reports(service, account_id, slug):
    reports = EventReports(service.db)
    if request.method == 'GET':
        return jsonify(reports=reports.board(slug, account_id, _offset())), 200
    return _create(service, reports.event_for_slug(slug)['event_id'], account_id)


@event_desk_bp.get('/portal/<slug>/mine')
@_private
def own_reports(service, account_id, slug):
    return jsonify(EventReports(service.db).mine(slug, account_id, _offset())), 200


@event_desk_bp.route('/<identifier>/reports', methods=['GET', 'POST'])
@_private
def staff_reports(service, account_id, identifier):
    service.authorize_workspace(identifier, account_id)
    if request.method == 'POST':
        return _create(service, identifier, account_id)
    return jsonify(reports=EventReports(service.db).queue(identifier, account_id, _offset())), 200


@event_desk_bp.get('/<identifier>/reports/<report_id>')
@_private
def report_detail(service, account_id, identifier, report_id):
    return jsonify(EventReports(service.db).detail(identifier, report_id, account_id)), 200


@event_desk_bp.get('/<identifier>/reports/<report_id>/matches')
@_private
def report_matches(service, account_id, identifier, report_id):
    if not rate_limit.allow(f'event-matches:{account_id}', 30, 60):
        raise EventError('Too many matching requests. Wait a minute before trying again.', 429)
    return jsonify(EventMatching(service.db).suggestions(identifier, report_id, account_id, _offset())), 200


@event_desk_bp.route('/<identifier>/reports/<report_id>/alerts', methods=['GET', 'POST'])
@_private
def event_match_alert(service, account_id, identifier, report_id):
    alerts = EventAlerts(service.db)
    if request.method == 'GET':
        if set(request.args) != {'found_report_id', 'missing_version', 'found_version'}:
            raise EventError('Supply the found report and reviewed report versions.')
        payload = {'found_report_id': request.args['found_report_id']}
        for name in ('missing_version', 'found_version'):
            raw = request.args[name]
            if not raw.isascii() or not raw.isdigit() or len(raw) > 10 or not 1 <= int(raw) <= 2147483647:
                raise EventError('Supply valid reviewed report versions.')
            payload[name] = int(raw)
        return jsonify(preview=alerts.preview(identifier, report_id, payload, account_id)), 200
    if not rate_limit.allow(f'event-alert-send:{account_id}', 10, 60):
        raise EventError('Too many alert attempts. Wait a minute.', 429)
    return jsonify(alerts.send(identifier, report_id, request.get_json(silent=True), account_id)), 200


@event_desk_bp.get('/portal/<slug>/alerts')
@_private
def own_event_alerts(service, account_id, slug):
    return jsonify(alerts=EventAlerts(service.db).mine(slug, account_id, _offset(), request.args.get('view', 'inbox'))), 200


@event_desk_bp.get('/portal/<slug>/alerts/count')
@_private
def event_alert_count(service, account_id, slug):
    return jsonify(EventAlerts(service.db).count(slug, account_id)), 200


@event_desk_bp.post('/<identifier>/alerts/<alert_id>/actions')
@_private
def own_event_alert_action(service, account_id, identifier, alert_id):
    if not rate_limit.allow(f'event-alert-action:{account_id}', 60, 60):
        raise EventError('Too many alert actions. Wait a minute.', 429)
    return jsonify(alert=EventAlerts(service.db).action(identifier, alert_id, request.get_json(silent=True), account_id)), 200


@event_desk_bp.post('/<identifier>/reports/<report_id>/actions')
@_private
def report_action(service, account_id, identifier, report_id):
    if not rate_limit.allow(f'event-desk-action:{account_id}', 60, 60):
        raise EventError('Too many actions. Wait a minute and try again.', 429)
    return jsonify(report=EventReports(service.db).action(identifier, report_id, request.get_json(silent=True), account_id)), 200


@event_desk_bp.get('/<identifier>/reports/<report_id>/photo')
@_private
def report_photo(service, account_id, identifier, report_id):
    content = EventReports(service.db).photo(identifier, report_id, account_id)
    return send_file(io.BytesIO(content), mimetype='image/webp', max_age=0), 200


@event_desk_bp.route('/portal/<slug>/claims', methods=['GET', 'POST'])
@_private
def own_event_claims(service, account_id, slug):
    recovery = EventRecovery(service.db)
    if request.method == 'GET':
        return jsonify(claims=recovery.mine(slug, account_id, _offset())), 200
    if not rate_limit.allow(f'event-claim-create:{account_id}', 10, 60):
        raise EventError('Too many claim attempts. Wait a minute.', 429)
    if request.is_json:
        payload, photo = request.get_json(silent=True), None
    else:
        if set(request.form) != {'payload'} or set(request.files) - {'proof'}:
            raise EventError('Invalid ownership claim form.')
        try:
            payload = json.loads(request.form['payload'])
        except (TypeError, ValueError):
            raise EventError('Invalid ownership claim form.') from None
        upload = request.files.get('proof')
        photo = upload.stream.read(MAX_BYTES + 1) if upload else None
    event = recovery.reports.event_for_slug(slug)
    return jsonify(claim=recovery.create(event['event_id'], payload, account_id, photo)), 201


@event_desk_bp.get('/<identifier>/claims')
@_private
def staff_event_claims(service, account_id, identifier):
    return jsonify(claims=EventRecovery(service.db).queue(identifier, account_id, request.args.get('report_id'), _offset())), 200


@event_desk_bp.get('/<identifier>/claims/<claim_id>')
@_private
def event_claim_detail(service, account_id, identifier, claim_id):
    return jsonify(EventRecovery(service.db).detail(identifier, claim_id, account_id)), 200


@event_desk_bp.post('/<identifier>/claims/<claim_id>/actions')
@_private
def event_claim_action(service, account_id, identifier, claim_id):
    if not rate_limit.allow(f'event-claim-action:{account_id}', 30, 60):
        raise EventError('Too many claim actions. Wait a minute.', 429)
    return jsonify(claim=EventRecovery(service.db).action(identifier, claim_id, request.get_json(silent=True), account_id)), 200


@event_desk_bp.get('/<identifier>/claims/<claim_id>/proof')
@_private
def event_claim_proof(service, account_id, identifier, claim_id):
    content = EventRecovery(service.db).proof(identifier, claim_id, account_id)
    return send_file(io.BytesIO(content), mimetype='image/webp', max_age=0), 200


@event_desk_bp.get('/<identifier>/claims/<claim_id>/receipt')
@_private
def event_claim_receipt(service, account_id, identifier, claim_id):
    return jsonify(receipt=EventRecovery(service.db).receipt(identifier, claim_id, account_id)), 200


@event_desk_bp.get('/receipts/<claim_id>/verify')
def verify_event_receipt(claim_id):
    try:
        if current_app.config.get('EVENTS_FOUNDATION_ENABLED') is not True:
            raise EventError('Event receipts are unavailable.', 503)
        if not rate_limit.allow(f'event-receipt-verify:{request.remote_addr}', 60, 60):
            raise EventError('Too many verification attempts. Try again later.', 429)
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        response = make_response(jsonify(EventRecovery(db).verify_receipt(claim_id, request.args.get('code', ''))), 200)
    except EventError as error:
        response = make_response(jsonify(error=str(error), code=error.code), error.status)
    except Exception:
        current_app.logger.exception('Event receipt verification unavailable')
        response = make_response(jsonify(error='Receipt verification unavailable.'), 503)
    response.headers['Cache-Control'] = 'no-store'
    return response
