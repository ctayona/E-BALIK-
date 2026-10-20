"""Reports & Analytics page: aggregated report data."""
from flask import Blueprint, Response, current_app, jsonify, request
from app.utils import get_db
from Admin.Backend.shared.admin_access import _require_admin

reports_analytics_bp = Blueprint('admin_reports_analytics', __name__)


@reports_analytics_bp.route('/reports', methods=['GET'])
def admin_reports():
    try:
        _require_admin()
        db = get_db(
            url=current_app.config['SUPABASE_URL'],
            service_key=current_app.config['SUPABASE_SERVICE_KEY']
        )
        return jsonify({
            'summary': db.get_admin_dashboard_summary(),
            **db.get_admin_analytics_breakdowns(),
        }), 200
    except ValueError as error:
        return jsonify({'error': str(error)}), 401
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Admin report aggregation error: %s', error)
        return jsonify({'error': 'Unable to load analytics reports'}), 500


# ---------------------------------------------------------------------------------------------- monthly office report
def _monthly_db():
    return get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])


@reports_analytics_bp.route('/reports/monthly', methods=['GET'])
def monthly_report():
    """The Lost and Found Office's report for one month (?month=YYYY-MM), with the month before for comparison."""
    try:
        _require_admin()
        from app.utils import monthly_report as monthly
        return jsonify(monthly.build(_monthly_db(), request.args.get('month'))), 200
    except ValueError as error:
        status = 400 if 'month' in str(error).lower() or 'reports start' in str(error).lower() else 401
        return jsonify({'error': str(error)}), status
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Monthly report failed: %s', error)
        return jsonify({'error': 'Unable to build the monthly report'}), 500


@reports_analytics_bp.route('/reports/monthly/export', methods=['GET'])
def monthly_report_export():
    """The same report as a CSV file. The download is written to the activity log."""
    try:
        admin = _require_admin()
        from app.utils import monthly_report as monthly
        from Admin.Backend.shared.admin_access import _log_admin_action
        db = _monthly_db()
        report = monthly.build(db, request.args.get('month'))
        _log_admin_action(db, admin, 'Export Monthly Report', 'Reports', report['label'], report['month'])
        reply = Response('﻿' + monthly.to_csv(report), mimetype='text/csv')
        reply.headers['Content-Disposition'] = f'attachment; filename="ebalik-report-{report["month"]}.csv"'
        reply.headers['Cache-Control'] = 'no-store'
        return reply
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except PermissionError as error:
        return jsonify({'error': str(error)}), 403
    except Exception as error:
        current_app.logger.exception('Monthly report export failed: %s', error)
        return jsonify({'error': 'Unable to export the monthly report'}), 500
