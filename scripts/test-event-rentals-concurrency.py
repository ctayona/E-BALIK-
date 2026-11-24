"""Run independent sessions in disposable loopback PostgreSQL. No database URL."""
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import uuid

root = Path(__file__).resolve().parents[1]
binary = Path(sys.argv[1])
scratch = Path(tempfile.mkdtemp(prefix='rental-pg-', dir=root / 'node_modules/.cache'))
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = str(sock.getsockname()[1])
password = secrets.token_hex(32)
role = 'test_' + secrets.token_hex(6)
secret = scratch / 'password'
secret.write_text(password)
env = {**os.environ, 'PGPASSWORD': password, 'PGCONNECT_TIMEOUT': '3'}
def run(name, args, text=None):
    output = dict(stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) if name == 'pg_ctl' else dict(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return subprocess.run([str(binary / (name + '.exe')), *args], input=text,
                          text=True, **output, env=env, timeout=60,
                          creationflags=subprocess.CREATE_NO_WINDOW)
args = ['-X', '-h', '127.0.0.1', '-p', port, '-U', role, '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1']
def query(text):
    reply = run('psql', args, text)
    if reply.returncode:
        raise RuntimeError(reply.stderr)
    return reply.stdout.strip()
started = False
try:
    init = run('initdb', ['-D', str(scratch / 'data'), '-U', role, '--pwfile=' + str(secret),
                        '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'])
    assert init.returncode == 0, init.stderr
    secret.write_text('')
    started = True
    start = run('pg_ctl', ['-D', str(scratch / 'data'), '-l', str(scratch / 'server.log'),
                          '-o', '-h 127.0.0.1 -p ' + port, '-w', 'start'])
    assert start.returncode == 0, start.stderr
    # Reuse the SQL regression fixture schema, with no live application config.
    fixture = (root / 'scripts/test-event-rentals-sql.mjs').read_text().split('await db.exec(' + chr(96))[1].split(chr(96) + ');')[0]
    query(fixture)
    query((root / 'Server/manual_migrations/20261124b_event_rentals.sql').read_text())
    admin, owner, event = [str(uuid.uuid4()) for _ in range(3)]
    query(f"INSERT INTO user_profiles VALUES('{admin}','super_admin',true,null),('{owner}','user',true,null);"
          f"INSERT INTO event_workspaces VALUES('{event}','Campus night','University','draft',now()+interval '1 day',now()+interval '1 day 2 hours',null);")
    def command(action, data):
        encoded = json.dumps(data).replace("'", "''")
        return f"SELECT event_rental_command('{admin}','{uuid.uuid4()}','{action}','{encoded}'::jsonb)"
    package = json.loads(query(command('package', dict(name='Race package', price='500',
        included_tags=0, duration_hours=3, support='Desk', terms='Refund before setup'))))['id']
    booking = json.loads(query(command('book', dict(event_id=event, package_id=package,
        package_version=1, payer_id=owner, note='Organizer accepted terms'))))['id']
    for action, details in [
        ('confirm', dict(booking_id=booking, version=1, amount='500', method='cash',
                         reference='', proof_path=None, notes='Cash paid')),
        ('refund', dict(booking_id=booking, version=2, note='Organizer requested refund')),
    ]:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(run, 'psql', args, 'BEGIN;' + command(action, details) + ';SELECT pg_sleep(0.2);COMMIT;')
                       for _ in range(2)]
            outcomes = [future.result() for future in futures]
        assert sum(reply.returncode == 0 for reply in outcomes) == 1, outcomes
    assert query("SELECT count(*) FROM income_ledger WHERE kind='sale'") == '1'
    assert query("SELECT count(*) FROM income_ledger WHERE kind='refund'") == '1'
    assert float(query("SELECT sum(amount) FROM income_ledger")) == 0
    print('Independent PostgreSQL sessions passed competing full payment and refund.')
finally:
    if started:
        run('pg_ctl', ['-D', str(scratch / 'data'), '-m', 'fast', '-w', 'stop'])
    secret.write_text('')
