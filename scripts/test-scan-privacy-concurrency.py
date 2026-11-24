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
scratch = Path(tempfile.mkdtemp(prefix='privacy-pg-', dir=root / 'node_modules/.cache'))
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
    fixture = (root / 'scripts/test-scan-privacy-report-review-sql.mjs').read_text().split('await db.exec(' + chr(96))[1].split(chr(96) + ');')[0]
    query(fixture)
    query("alter table found_items add created_at timestamptz default now();alter table missing_items add created_at timestamptz default now();")
    query((root / 'Server/manual_migrations/20261125_scan_privacy_and_report_review.sql').read_text())
    admin, owner, report, scan_id = [str(uuid.uuid4()) for _ in range(4)]
    tag = 'ABCDEFGHJK23'
    token_hash = 'a'*64
    query(f"insert into user_profiles values('{admin}','super_admin',true,null),('{owner}','user',true,null);"
          f"insert into smart_tags values('{tag}','{owner}','active',false,null);"
          f"insert into found_items(item_id,item_name,status) values('{report}','Fixture bottle','unclaimed');")
    def compete(commands):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(run,'psql',args,'BEGIN;'+command+';SELECT pg_sleep(0.15);COMMIT;') for command in commands]
            return [future.result() for future in futures]
    commands=[f"select report_publication_review('{admin}','{uuid.uuid4()}','found','{report}',1,'approved','')" for _ in range(2)]
    results=compete(commands)
    assert sum(r.returncode==0 for r in results)==1, [r.stderr for r in results]
    assert query('select count(*) from report_publication_history')=='1'
    def scan(action,data=None):
        encoded=json.dumps(data or {}).replace("'", "''")
        return f"select smart_tag_scan_command('{action}','{scan_id}','{tag}','{token_hash}','{encoded}'::jsonb)"
    results=compete([scan('record'),scan('record')])
    assert all(r.returncode==0 for r in results), [r.stderr for r in results]
    assert query('select count(*) from smart_tag_scans')=='1'
    area=dict(admin_consent=True,owner_consent=False,consent_version='scan-v1',venue='Gymnasium',point=None)
    results=compete([scan('share',area),scan('withdraw')])
    assert any(r.returncode==0 for r in results)
    assert query("select count(*) from smart_tag_scans where withdrawn_at is not null and venue is null and not admin_consent")=='1'
    print('PASS: independent PostgreSQL sessions - competing report approvals, duplicate page-open records, share/withdraw race.')
finally:
    if started:
        run('pg_ctl', ['-D', str(scratch / 'data'), '-m', 'fast', '-w', 'stop'])
    secret.write_text('')
