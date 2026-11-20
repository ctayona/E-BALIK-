// In-memory Postgres only: node scripts/test-event-lifecycle-sql.mjs <local-pglite-module>
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
if (!process.argv[2]) throw new Error('Supply a local PGlite module path. No database URL.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const check = (value) => { assert.ok(value); checks++; };
const actor = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const event = '33333333-3333-4333-8333-333333333333';
const count = async (table) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
const reject = async (sql) => { await assert.rejects(() => db.exec(sql)); checks++; };
const call = async (target, version, caller = actor, note = 'Reviewed by event administrator') => (await db.query('SELECT public.event_transition($1,$2,$3,$4,$5) AS result', [event, caller, version, target, note])).rows[0].result;
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE user_profiles(account_id UUID PRIMARY KEY,access_level TEXT,is_active BOOLEAN,suspended_until TIMESTAMPTZ);
    CREATE TABLE migration_log(name VARCHAR(160) PRIMARY KEY,applied_at TIMESTAMPTZ DEFAULT now(),note TEXT);
    CREATE TABLE found_items(item_id INTEGER PRIMARY KEY,item_name TEXT);
    INSERT INTO found_items VALUES(1,'Campus sentinel');
    INSERT INTO user_profiles VALUES('${actor}','super_admin',true,NULL),('${member}','user',true,NULL);
    INSERT INTO migration_log(name) VALUES('20261026_income_ledger_lock');
    GRANT SELECT ON user_profiles TO service_role;`);
  await db.exec(await readFile(new URL('../Server/manual_migrations/20261115_event_foundation.sql', import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO event_workspaces(event_id,name,slug,created_by) VALUES('${event}','Campus event','campus-event','${actor}')`);
  const migration = await readFile(new URL('../Server/manual_migrations/20261116_event_lifecycle.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  check((await db.query('SELECT status,version FROM event_workspaces')).rows[0].status === 'draft');
  check((await db.query('SELECT item_name FROM found_items')).rows[0].item_name === 'Campus sentinel');
  check((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='event_state_history'::regclass")).rows[0].relrowsecurity);
  for (const role of ['anon', 'authenticated']) {
    check(!(await db.query(`SELECT has_table_privilege('${role}','event_state_history','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS yes`)).rows[0].yes);
    check(!(await db.query(`SELECT has_function_privilege('${role}','event_transition(uuid,uuid,integer,text,text)','EXECUTE') AS yes`)).rows[0].yes);
  }
  check(!(await db.query("SELECT has_table_privilege('service_role','event_state_history','UPDATE,DELETE,TRUNCATE') AS yes")).rows[0].yes);
  check((await db.query("SELECT has_table_privilege('service_role','event_state_history','SELECT') AND has_table_privilege('service_role','event_state_history','INSERT') AS yes")).rows[0].yes);
  check((await call('scheduled', 1)).ok === false); // Missing setup cannot activate.
  check(await count('event_state_history') === 0);
  await db.exec(`UPDATE event_workspaces SET organizer_name='Student council',venue='Gymnasium',desk_instructions='Main entrance recovery desk',starts_at=now()+interval '1 hour',ends_at=now()+interval '2 hours',recovery_ends_at=now()+interval '3 hours';
    INSERT INTO event_memberships(event_id,account_id,role,expires_at) VALUES('${event}','${member}','manager',now()+interval '4 hours');`);
  check(!(await call('scheduled', 1, member)).ok);
  check(!(await call('scheduled', 9)).ok);
  check(!(await call('scheduled', 1, actor, '<bad>')).ok);
  await db.exec(`UPDATE user_profiles SET suspended_until=now()+interval '1 day' WHERE account_id='${member}'`);
  check(!(await call('scheduled', 1)).ok);
  await db.exec(`UPDATE user_profiles SET suspended_until=NULL WHERE account_id='${member}'; UPDATE event_memberships SET status='revoked'`);
  check(!(await call('scheduled', 1)).ok);
  await db.exec(`UPDATE event_memberships SET status='active',expires_at=now()+interval '150 minutes'`);
  check(!(await call('scheduled', 1)).ok); // Manager must cover recovery deadline.
  await db.exec(`UPDATE event_memberships SET expires_at=now()+interval '4 hours'; SET ROLE service_role`);
  const scheduled = await call('scheduled', 1);
  check(scheduled.ok && scheduled.event.status === 'scheduled' && scheduled.event.version === 2);
  check(!(await call('active', 2)).ok); // Too early.
  check(!(await call('draft', 1)).ok); // Stale version cannot change state or history.
  check(await count('event_state_history') === 1);
  check((await call('draft', 2)).ok);
  await db.exec(`RESET ROLE; UPDATE event_workspaces SET starts_at=now()-interval '1 hour'`);
  check(!(await call('scheduled', 3)).ok);
  const active = await call('active', 3);
  check(active.ok && active.event.version === 4);
  check(!(await call('closed', 4)).ok);
  check(!(await call('recovery', 4)).ok);
  await db.exec(`UPDATE event_workspaces SET ends_at=now()-interval '1 minute'`);
  check((await call('recovery', 4)).ok);
  check(!(await call('closed', 5)).ok); // Do not shorten recovery implicitly.
  await db.exec(`UPDATE event_workspaces SET recovery_ends_at=now()-interval '30 seconds'`);
  check((await call('closed', 5)).ok);
  check((await call('archived', 6)).ok);
  check(!(await call('draft', 7)).ok);
  check(await count('event_state_history') === 6);
  check((await db.query('SELECT from_status,to_status,note FROM event_state_history ORDER BY created_at LIMIT 1')).rows[0].from_status === 'draft');
  await reject('UPDATE event_workspaces SET status=\'published\'');
  await db.exec(`UPDATE event_workspaces SET status='draft'`); // Test fixture reset only.
  check((await call('cancelled', 7)).ok);
  check(!(await call('active', 8)).ok);
  await reject(migration); await db.exec('ROLLBACK');
  check(await count('event_state_history') === 7);
  check(await count('migration_log') === 3);
  // A failed history insert must roll back the event update in the same statement.
  await db.exec(`UPDATE event_workspaces SET status='draft';
    CREATE FUNCTION fail_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic write failure'; END $$;
    CREATE TRIGGER fail_history BEFORE INSERT ON event_state_history FOR EACH ROW EXECUTE FUNCTION fail_history();`);
  await assert.rejects(() => call('cancelled', 8)); checks++;
  check((await db.query('SELECT status,version FROM event_workspaces')).rows[0].status === 'draft');
  check((await db.query('SELECT version FROM event_workspaces')).rows[0].version === 8);
  check(await count('event_state_history') === 7);
  check((await db.query('SELECT item_name FROM found_items')).rows[0].item_name === 'Campus sentinel');
  console.log(`Event lifecycle: ${checks} isolated Postgres checks passed.`);
} finally { await db.close(); }
