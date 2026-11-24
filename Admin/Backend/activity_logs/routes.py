"""Activity Logs page: user and administrator activity (also read by Notifications)."""
from flask import Blueprint, Response, current_app, jsonify, request
from app.utils import get_db
from Admin.Backend.shared.admin_access import _require_admin

activity_logs_bp = Blueprint('admin_activity_logs', __name__)


@activity_logs_bp.route('/tag-scan-activity',methods=['GET','POST'])
def tag_scan_activity():
    from app.utils import tag_scans
    from app.utils.smart_tags import SmartTagService,TagError
    actor=None
    try:
        actor=_require_admin()
        db=get_db(url=current_app.config['SUPABASE_URL'],service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        service=SmartTagService(db)
        if request.method=='GET':
            offset=int(request.args.get('offset','0'))
            if not 0<=offset<=100000: raise TagError('Invalid scan page')
            result=tag_scans.list_scans(service,offset,request.args.get('tag',''),request.args.get('state','all'))
        else:
            from uuid import UUID
            if not tag_scans.enabled(db.client): raise TagError('Apply and enable scan logging first',503)
            body=request.get_json(silent=True) or {}
            if type(body.get('version')) is not int: raise TagError('Refresh this scan first')
            result=db.client.rpc('smart_tag_scan_command',dict(p_action='resolve',p_scan=str(UUID(str(body.get('scan_id')))),
                p_tag='',p_hash='',p_actor=actor['account_id'],p_data={'version':body['version']})).execute().data
            db.log_user_activity(account_id=actor['account_id'],user_name=actor.get('email') or 'Admin',action='Resolve Smart Tag scan',
                module='Smart Tags',target_name='Scan activity',target_id=body['scan_id'],result='success')
        reply=jsonify(result)
        reply.headers['Cache-Control']='no-store'
        return reply
    except TagError as error: return jsonify(error=error.message),error.status
    except PermissionError as error: return jsonify(error=str(error)),403
    except ValueError as error: return jsonify(error=str(error)),401 if actor is None else 400
    except Exception:
        current_app.logger.warning('Scan activity request unavailable')
        return jsonify(error='Scan changed or setup is unavailable. Refresh and try again.'),409


class BadDates(Exception):
    """The export's date range is not usable (answered with 400, unlike a bad login which is 401)."""


@activity_logs_bp.route('/activity-logs', methods=['GET'])
def list_activity_logs():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'logs': db.get_activity_logs_for_actor_type(include_admins=False, limit=100)}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.error(f'Admin activity logs error: {error}')
        return jsonify({'error': 'Unable to load activity logs'}), 500


@activity_logs_bp.route('/admin-activity-logs', methods=['GET'])
def list_admin_activity_logs():
    try:
        _require_admin(required_level='super_admin')
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({'logs': db.get_activity_logs_for_actor_type(include_admins=True, limit=200)}), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Superadmin activity log listing error: %s', error)
        return jsonify({'error': 'Unable to load administrator activity logs'}), 500


@activity_logs_bp.route('/activity-logs/export', methods=['GET'])
def export_activity_logs():
    """The activity log as a CSV file (?scope=user|admin, ?from=YYYY-MM-DD, ?to=YYYY-MM-DD, Manila days). The download is itself written to the log."""
    try:
        import csv
        import io
        from datetime import date, datetime, timedelta, timezone
        from Admin.Backend.shared.admin_access import _log_admin_action
        from app.utils.system_ops import csv_safe
        scope = 'admin' if request.args.get('scope') == 'admin' else 'user'
        admin = _require_admin(required_level='super_admin' if scope == 'admin' else 'admin')
        campus = timezone(timedelta(hours=8))

        def day(name):
            raw = (request.args.get(name) or '').strip()
            if not raw:
                return None
            try:
                return date.fromisoformat(raw)
            except ValueError:
                raise BadDates(f'"{name}" must be a date like 2026-10-31.')
        start, end = day('from'), day('to')
        if start and end and start > end:
            raise BadDates('The start date must not be after the end date.')
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        logs = db.get_activity_logs_for_actor_type(include_admins=scope == 'admin', limit=1000)

        def kept(entry):
            try:
                moment = datetime.fromisoformat(str(entry.get('timestamp')).replace('Z', '+00:00'))
            except ValueError:
                return start is None and end is None
            local = (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).astimezone(campus).date()
            return (start is None or local >= start) and (end is None or local <= end)
        rows = [entry for entry in logs if kept(entry)]
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(['Log ID', 'Time (ISO)', 'Person', 'Account ID', 'Action', 'Module', 'Target', 'Target ID', 'Result'])
        for entry in rows:
            writer.writerow([csv_safe(entry.get(key, '')) for key in ('id', 'timestamp', 'user', 'userId', 'action', 'module', 'target', 'targetId', 'result')])
        _log_admin_action(db, admin, 'Export Activity Log', 'Reports', f'{scope} activity log', f'{len(rows)} records')
        reply = Response('﻿' + out.getvalue(), mimetype='text/csv')
        reply.headers['Content-Disposition'] = f'attachment; filename="ebalik-{scope}-activity-log.csv"'
        reply.headers['Cache-Control'] = 'no-store'
        return reply
    except BadDates as error:
        return jsonify({'error': str(error)}), 400
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Activity log export failed: %s', error)
        return jsonify({'error': 'Unable to export the activity log'}), 500
