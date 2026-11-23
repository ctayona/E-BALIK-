"""Super-admin-only draft management; disabled until explicitly configured."""
from functools import wraps
from flask import Blueprint, current_app, jsonify, request, make_response
from app.utils import get_db
from app.utils.events import EventError, EventFoundation, available
from app.utils.event_assets import EventAssets, MAX_BYTES
from app.utils.event_lifecycle import EventLifecycle
from app.utils.event_reports import EventReports
from app.utils.event_recovery import EventRecovery
from app.utils.event_share import EventShare
from app.utils.event_pilot import EventPilot
from app.utils import rate_limit
from Admin.Backend.shared.admin_access import _require_admin, _log_admin_action

events_bp = Blueprint('admin_events', __name__)


@events_bp.after_request
def private_event_response(response):
    response.headers['Cache-Control'] = 'no-store'
    return response


def pilot_offset():
    raw = request.args.get('offset', '0')
    if not raw.isascii() or not raw.isdigit() or len(raw) > 6 or int(raw) > 100000:
        raise EventError('Invalid operations page.')
    return int(raw)


def _handled(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_app.config.get('EVENTS_FOUNDATION_ENABLED') is not True:
            return jsonify(error='Event foundation is disabled.', code='events_disabled'), 503
        try:
            actor = _require_admin('super_admin')
            if request.content_length and request.content_length > MAX_BYTES + 65536:
                raise EventError('Request is too large.', 413, 'request_too_large')
            db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
            response = make_response(view(EventFoundation(db), db, actor, *args, **kwargs))
            response.headers['Cache-Control'] = 'no-store'
            return response
        except EventError as error:
            return jsonify(error=str(error), code=error.code, setup_required=error.code == 'setup_required'), error.status
        except ValueError:
            return jsonify(error='Valid authentication required.'), 401
        except PermissionError:
            return jsonify(error='Super administrator access required.'), 403
        except Exception:
            current_app.logger.exception('Event foundation request failed')
            return jsonify(error='Unable to process the event request.'), 500
    return wrapped


@events_bp.route('/events/options', methods=['GET'])
@_handled
def event_options(service, db, actor):
    return jsonify(venues=available(db.client, events=True)), 200


@events_bp.route('/events/<identifier>/review', methods=['GET'])
@_handled
def review_event(service, db, actor, identifier):
    review = EventLifecycle(db).review(identifier)
    reports = EventReports(db)
    review.update(reports_available=reports.installed(), portal_open=reports.open(review['event']))
    review['management_available'] = EventRecovery(db).installed()
    review['public_reporting_enabled'] = review['portal_open']
    return jsonify(review), 200


@events_bp.route('/events/<identifier>/share', methods=['GET'])
@_handled
def share_event(service, db, actor, identifier):
    return jsonify(EventShare(db).view(identifier)), 200


@events_bp.get('/events/<identifier>/operations')
@_handled
def pilot_summary(service, db, actor, identifier):
    return jsonify(EventPilot(db).snapshot(identifier, actor['account_id'], pilot_offset(), request.args.get('view', 'all'))), 200


@events_bp.get('/events/<identifier>/operations/export')
@_handled
def pilot_export(service, db, actor, identifier):
    if not rate_limit.allow(f"event-export:{actor['account_id']}", 5, 60): raise EventError('Wait before downloading another event export.', 429)
    data = EventPilot(db).export(identifier, actor['account_id'])
    _log_admin_action(db, actor, 'Export Event Closing Register', 'Events', 'Scoped spreadsheet-safe register', identifier)
    response = make_response(data, 200); response.headers.update({'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="event-closing-register.zip"'})
    return response


@events_bp.get('/events/<identifier>/hub/<report_id>')
@_handled
def pilot_hub_preview(service, db, actor, identifier, report_id):
    return jsonify(EventPilot(db).preview(identifier, report_id, actor['account_id'])), 200


@events_bp.get('/events/<identifier>/receiver-lookup')
@_handled
def pilot_receiver(service, db, actor, identifier):
    if not rate_limit.allow(f"event-receiver-lookup:{actor['account_id']}", 30, 60): raise EventError('Wait before another staff lookup.', 429)
    return jsonify(person=EventPilot(db).receiver_lookup(identifier, actor['account_id'], request.args.get('email', ''))), 200


@events_bp.post('/events/<identifier>/operations')
@_handled
def pilot_operation(service, db, actor, identifier):
    if not rate_limit.allow(f"event-pilot:{actor['account_id']}", 30, 60): raise EventError('Wait before another event operation.', 429)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or set(payload) != {'action', 'data'}: raise EventError('Choose a reviewed operation.')
    result = EventPilot(db).command(identifier, actor['account_id'], payload['action'], payload['data'])
    _log_admin_action(db, actor, 'Event Pilot Operation', 'Events', payload['action'], identifier)
    return jsonify(result), 200


@events_bp.route('/events/<identifier>/manage', methods=['POST'])
@_handled
def manage_event(service, db, actor, identifier):
    payload = request.get_json(silent=True)
    row = EventRecovery(db).manage(identifier, payload, actor['account_id'])
    _log_admin_action(db, actor, 'Manage Event Workspace', 'Events', payload['action'], identifier)
    return jsonify(event=row), 200


@events_bp.route('/events/<identifier>/portal', methods=['POST'])
@_handled
def set_event_portal(service, db, actor, identifier):
    row = EventReports(db).set_portal(identifier, request.get_json(silent=True), actor['account_id'])
    _log_admin_action(db, actor, 'Open Event Portal' if row['portal_enabled'] else 'Pause Event Portal', 'Events', row['name'], identifier)
    return jsonify(event=row), 200


@events_bp.route('/events/<identifier>/transition', methods=['POST'])
@_handled
def transition_event(service, db, actor, identifier):
    row = EventLifecycle(db).transition(identifier, request.get_json(silent=True), actor['account_id'])
    _log_admin_action(db, actor, 'Change Event State', 'Events', row['status'], row['event_id'])
    return jsonify(event=row), 200


@events_bp.route('/events/<identifier>/staff-lookup', methods=['GET'])
@_handled
def staff_lookup(service, db, actor, identifier):
    return jsonify(person=service.staff_lookup(identifier, request.args.get('email', ''))), 200


@events_bp.route('/events/<identifier>/assets', methods=['GET'])
@_handled
def list_assets(service, db, actor, identifier):
    return jsonify(assets=EventAssets(db).list(identifier)), 200


@events_bp.route('/events/<identifier>/assets/<kind>', methods=['POST'])
@_handled
def save_asset(service, db, actor, identifier, kind):
    raw = request.form.get('revision', '')
    if not raw.isascii() or not raw.isdigit() or len(raw) > 9:
        raise EventError('Supply the current artwork revision.')
    remove = request.form.get('remove') == 'true'
    photo = request.files.get('file')
    if (remove and photo) or (not remove and photo is None):
        raise EventError('Choose a file or remove the current artwork.')
    data = None if remove else photo.stream.read(MAX_BYTES + 1)
    row = EventAssets(db).save(identifier, kind, data, int(raw), actor['account_id'])
    _log_admin_action(db, actor, 'Remove Event Artwork' if remove else 'Upload Event Artwork', 'Events', kind, identifier)
    return jsonify(asset=row), 200


@events_bp.route('/events/<identifier>/memberships', methods=['GET', 'POST'])
@_handled
def event_memberships(service, db, actor, identifier):
    if request.method == 'GET':
        return jsonify(memberships=service.memberships(identifier)), 200
    row = service.assign(identifier, request.get_json(silent=True), actor['account_id'])
    _log_admin_action(db, actor, 'Assign Event Staff', 'Events', row['role'], row['event_id'])
    return jsonify(membership=row), 201


@events_bp.route('/events/<identifier>/memberships/<membership_id>/revoke', methods=['POST'])
@_handled
def revoke_membership(service, db, actor, identifier, membership_id):
    row = service.revoke(identifier, membership_id)
    _log_admin_action(db, actor, 'Revoke Event Staff', 'Events', row['role'], row['event_id'])
    return jsonify(membership=row), 200


@events_bp.route('/events', methods=['GET'])
@_handled
def list_events(service, db, actor):
    raw = request.args.get('offset', '0')
    if not raw.isdigit() or len(raw) > 7 or int(raw) > 100000:
        raise EventError('Invalid pagination offset.')
    rows, management = EventRecovery(db).list_events(int(raw), request.args.get('view', 'all'))
    return jsonify(events=rows, page_size=50, management_available=management), 200


@events_bp.route('/events', methods=['POST'])
@_handled
def create_event(service, db, actor):
    row = service.create(request.get_json(silent=True), actor['account_id'])
    _log_admin_action(db, actor, 'Create Event Draft', 'Events', row['name'], row['event_id'])
    return jsonify(event=row), 201


@events_bp.route('/events/<identifier>', methods=['GET'])
@_handled
def get_event(service, db, actor, identifier):
    return jsonify(event=service.get(identifier, include_deleted=True)), 200


@events_bp.route('/events/<identifier>', methods=['PATCH'])
@_handled
def update_event(service, db, actor, identifier):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise EventError('Supply an event update object.')
    body = dict(body)
    version = body.pop('version', None)
    row = service.update(identifier, body, version)
    _log_admin_action(db, actor, 'Update Event Draft', 'Events', row['name'], row['event_id'])
    return jsonify(event=row), 200
