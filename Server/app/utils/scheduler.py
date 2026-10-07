"""Scheduled background jobs: auction pickup deadlines (48h final warning, 72h forfeiture).

Three ways to run the same job, because a free Render service sleeps when idle and a sleeping process cannot keep time:
  1. A small in-process timer thread, started with the app (`start_scheduler`). Works whenever the service is awake.
  2. `POST /api/cron/run` with the header `X-Cron-Secret: <CRON_SECRET>`: point any external scheduler at it
     (cron-job.org, a Render Cron Job, a GitHub Actions schedule, Supabase pg_cron + pg_net). The request also wakes a sleeping service.
  3. `python Server/scripts/run_cron.py` for a Render Cron Job or any server crontab.
Every step claims its row with a conditional database update, so overlapping runs from all three can never double-warn or double-forfeit.

Settings: SCHEDULER_ENABLED (default true; false turns the timer off), SCHEDULER_INTERVAL_MINUTES (default 15), CRON_SECRET.
"""
import hmac
import logging
import os
import threading
from typing import Any, Dict

from flask import Blueprint, current_app, jsonify, request

logger = logging.getLogger(__name__)

cron_bp = Blueprint('cron', __name__)
_started = threading.Event()


def run_scheduled_jobs(app) -> Dict[str, Any]:
    """Run every job once inside an app context and return a summary of what changed. Never raises."""
    summary: Dict[str, Any] = {}
    with app.app_context():
        try:
            from app.utils import get_db
            from app.utils.auction_db import AuctionService
            db = get_db(url=app.config['SUPABASE_URL'], service_key=app.config['SUPABASE_SERVICE_KEY'])
            service = AuctionService(db)
            service.settle_and_notify(force=True)  # confirmed winners are notified, which also starts their pickup clock
            summary['auction_pickups'] = service.process_overdue_pickups()
        except Exception as error:
            logger.exception('Scheduled jobs failed: %s', error)
            summary['error'] = str(error)[:200]
    if summary.get('auction_pickups', {}).get('warned') or summary.get('auction_pickups', {}).get('forfeited'):
        logger.info('Scheduled jobs: %s', summary)
    return summary


def _interval_seconds() -> int:
    try:
        minutes = float(os.getenv('SCHEDULER_INTERVAL_MINUTES') or 15)
    except ValueError:
        minutes = 15
    return int(max(1, min(minutes, 1440)) * 60)


def start_scheduler(app) -> bool:
    """Start the timer thread once per process. Returns False when it is disabled or already running."""
    if app.config.get('TESTING') or (os.getenv('SCHEDULER_ENABLED') or 'true').strip().lower() in ('0', 'false', 'no', 'off'):
        return False
    if os.getenv('FLASK_DEBUG') and os.getenv('WERKZEUG_RUN_MAIN') != 'true':
        return False  # with the debug reloader the first process only supervises; the child runs the app and starts the timer
    if _started.is_set():
        return False
    _started.set()
    interval = _interval_seconds()
    stop = threading.Event()

    def loop():
        stop.wait(60)  # let the app finish starting before the first run
        while not stop.is_set():
            run_scheduled_jobs(app)
            stop.wait(interval)

    threading.Thread(target=loop, name='ebalik-scheduler', daemon=True).start()
    logger.info('✓ Scheduler started: auction pickup deadlines are checked every %d minutes', interval // 60)
    return True


@cron_bp.route('/run', methods=['POST'])
def run_now():
    """Secret-protected trigger for an external scheduler. 503 until CRON_SECRET is set, so it is never open by accident."""
    secret = (os.getenv('CRON_SECRET') or '').strip()
    if not secret:
        return jsonify({'error': 'CRON_SECRET is not set, so scheduled runs over HTTP are disabled.'}), 503
    supplied = request.headers.get('X-Cron-Secret', '')
    if not hmac.compare_digest(supplied.encode('utf-8'), secret.encode('utf-8')):
        return jsonify({'error': 'Invalid cron secret.'}), 403
    return jsonify({'success': True, **run_scheduled_jobs(current_app._get_current_object())}), 200
