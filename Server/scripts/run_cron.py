"""Run the scheduled jobs once (auction pickup warnings and forfeitures) and exit.

Use it as a Render Cron Job or in a crontab, for example every 15 minutes:
    python Server/scripts/run_cron.py
It loads the same environment as the API, so it needs the same SUPABASE_* and SENDGRID_* settings.
"""
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import create_app  # noqa: E402
from app.utils.scheduler import run_scheduled_jobs  # noqa: E402

if __name__ == '__main__':
    os.environ['SCHEDULER_ENABLED'] = 'false'  # this process runs the job itself; it must not also start the timer thread
    result = run_scheduled_jobs(create_app())
    print(json.dumps(result, default=str))
    sys.exit(1 if result.get('error') else 0)
