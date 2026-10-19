"""Create (or reset) an E-Balik account straight in the database, without the emailed one-time code.

For a fresh local installation: registration normally emails a code through SendGrid, so on a machine with no SendGrid key nobody could
sign in. This script writes the account the same way registration does (password hashed with bcrypt, same columns) and marks it verified.

Usage (from the Server folder, with the virtual environment active):
    python scripts/create_local_account.py --email you@umak.edu.ph --first Juan --last "Dela Cruz" --level super_admin
It asks for the password (at least 16 characters, like the registration form). Run it again for the same email to reset the password or
change the level. It reads Environment_Configs/backend/.env, so it writes to the Supabase project named there.
"""
import argparse
import getpass
import re
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

LEVELS = ('user', 'guard', 'admin', 'super_admin')
MIN_PASSWORD = 16
_EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def build_account(email: str, first: str, last: str, level: str, campus_id: Optional[str], password_hash: str) -> Dict[str, Any]:
    """The row to store. Pure, so it can be tested without a database."""
    email = email.strip().lower()
    if not _EMAIL.match(email):
        raise ValueError('Enter a valid email address.')
    if level not in LEVELS:
        raise ValueError(f'Level must be one of: {", ".join(LEVELS)}.')
    if not first.strip() or not last.strip():
        raise ValueError('First and last name are required.')
    return {
        'account_id': str(uuid.uuid4()),
        'campus_id': (campus_id or '').strip() or f'LOCAL-{uuid.uuid4().hex[:8].upper()}',
        'fname': first.strip(),
        'mname': '',
        'lname': last.strip(),
        'email': email,
        'password_hash': password_hash,
        'user_role': 'Others',
        'access_level': level,
        'auth_provider': 'local',
        'verification_status': 'verified',
        'failed_login_attempts': 0,
        'locked_until': None,
        'is_active': True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--email', required=True)
    parser.add_argument('--first', required=True, help='first name')
    parser.add_argument('--last', required=True, help='last name')
    parser.add_argument('--level', default='user', choices=LEVELS, help='user (default), guard, admin or super_admin')
    parser.add_argument('--campus-id', default='', help='optional; a LOCAL-... id is made up when left out')
    parser.add_argument('--password', default='', help='optional; you are asked for it when left out (safer, it stays out of your shell history)')
    args = parser.parse_args()

    password = args.password or getpass.getpass('Password (at least 16 characters): ')
    if len(password) < MIN_PASSWORD:
        print(f'The password must have at least {MIN_PASSWORD} characters.')
        return 2

    from app.utils import PasswordService, get_db
    from config import Config

    if not (Config.SUPABASE_URL and Config.SUPABASE_SERVICE_KEY):
        print('SUPABASE_URL and SUPABASE_SERVICE_KEY are missing. Fill in Environment_Configs/backend/.env first.')
        return 2
    try:
        row = build_account(args.email, args.first, args.last, args.level, args.campus_id, PasswordService.hash_password(password))
    except ValueError as error:
        print(error)
        return 2

    db = get_db(url=Config.SUPABASE_URL, service_key=Config.SUPABASE_SERVICE_KEY)
    table = db.client.table('user_profiles')
    existing = table.select('account_id').eq('email', row['email']).limit(1).execute().data or []
    if existing:
        table.update({'password_hash': row['password_hash'], 'access_level': row['access_level'], 'verification_status': 'verified', 'is_active': True,
                      'failed_login_attempts': 0, 'locked_until': None}).eq('account_id', existing[0]['account_id']).execute()
        print(f"Updated {row['email']}: password reset, level {row['access_level']}, verified.")
    else:
        table.insert(row).execute()
        print(f"Created {row['email']} with level {row['access_level']} (verified).")
    return 0


if __name__ == '__main__':
    sys.exit(main())
