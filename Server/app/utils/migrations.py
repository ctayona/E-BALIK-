"""Which database migrations have been run.

Supabase does not record SQL Editor runs, so migration 20261017 creates `migration_log` and every migration file ends by adding its own
row. The health scan on the System control page compares the log with the files in `Server/manual_migrations/`, so a forgotten
migration shows up as a warning instead of as a broken feature weeks later.
"""
import logging
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / 'manual_migrations'
LOG_MIGRATION = '20261017_custody_log_receipts_and_migration_log'


def expected_migrations() -> List[str]:
    """The migration files shipped with this version of the app, oldest first."""
    try:
        return sorted(path.stem for path in MIGRATIONS_DIR.glob('*.sql'))
    except OSError:
        return []


def migration_status(client, expected: List[str] = None) -> Dict[str, Any]:
    """`available` is False when the log table does not exist yet (migration 20261017 has not been run)."""
    expected = expected_migrations() if expected is None else expected
    try:
        rows = client.table('migration_log').select('name').limit(1000).execute().data or []
    except Exception as error:
        logger.info('Migration log unavailable: %s', str(error)[:140])
        return {'available': False, 'applied': [], 'missing': expected, 'unknown': []}
    applied = sorted(str(row.get('name')) for row in rows)
    return {'available': True, 'applied': applied, 'missing': [name for name in expected if name not in applied],
            'unknown': [name for name in applied if name not in expected]}
