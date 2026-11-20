// Run with: node scripts/test-event-foundation-sql.mjs <path-to-pglite/dist/index.js>
// PGlite is a temporary test dependency, not an application dependency.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

if (!process.argv[2]) throw new Error('Supply the local PGlite module path. Never a database URL.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite(); // Ephemeral in-memory engine; no remote connection.
let checks = 0;
const check = (value) => { assert.ok(value); checks++; };
const rejected = async (sql) => {
  let failed = false;
  try { await db.exec(sql); } catch { failed = true; }
  assert.ok(failed, 'Expected SQL rejection');
  checks++;
};
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.user_profiles (account_id UUID PRIMARY KEY);
    CREATE TABLE public.migration_log (name VARCHAR(160) PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now(), note TEXT);
    CREATE TABLE public.found_items (item_id UUID PRIMARY KEY, item_name TEXT);
    INSERT INTO public.user_profiles VALUES ('11111111-1111-4111-8111-111111111111');
    INSERT INTO public.found_items VALUES ('22222222-2222-4222-8222-222222222222', 'Campus sentinel');
    INSERT INTO public.migration_log (name) VALUES ('20261026_income_ledger_lock');
  `);
  const before = (await db.query('SELECT * FROM public.found_items')).rows;
  const migration = await readFile(new URL('../Server/manual_migrations/20261115_event_foundation.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  check(JSON.stringify((await db.query('SELECT * FROM public.found_items')).rows) === JSON.stringify(before));
  check((await db.query('SELECT count(*)::int AS n FROM public.migration_log')).rows[0].n === 2);
  check((await db.query("SELECT count(*)::int AS n FROM pg_class WHERE oid IN ('event_workspaces'::regclass,'event_memberships'::regclass) AND relrowsecurity")).rows[0].n === 2);
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['event_workspaces', 'event_memberships']) {
      check(!(await db.query(`SELECT has_table_privilege('${role}', '${table}', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed`)).rows[0].allowed);
    }
  }
  check((await db.query("SELECT has_table_privilege('service_role', 'event_workspaces', 'SELECT,INSERT,UPDATE') AS allowed")).rows[0].allowed);
  check(!(await db.query("SELECT has_table_privilege('service_role', 'event_workspaces', 'DELETE,TRUNCATE') AS allowed")).rows[0].allowed);
  check(!(await db.query("SELECT has_table_privilege('service_role', 'event_memberships', 'DELETE,TRUNCATE') AS allowed")).rows[0].allowed);
  await db.exec("INSERT INTO event_workspaces (name,slug,created_by) VALUES ('Pilot','pilot','11111111-1111-4111-8111-111111111111')");
  await rejected("INSERT INTO event_workspaces (name,slug) VALUES ('Duplicate','pilot')");
  await rejected("UPDATE event_workspaces SET status='active'");
  await rejected("UPDATE event_workspaces SET starts_at=now()");
  await rejected("UPDATE event_workspaces SET starts_at=now(),ends_at=now()-interval '1 day',recovery_ends_at=now()+interval '1 day'");
  await rejected("UPDATE event_workspaces SET branding='{}'::jsonb");
  await rejected(`UPDATE event_workspaces SET branding='{"template":"classic","primary":null,"accent":"#ffffff","background":"#ffffff"}'::jsonb`);
  await rejected("UPDATE event_workspaces SET version=0");
  await db.exec(`INSERT INTO event_memberships (event_id,account_id,role,expires_at)
    SELECT event_id,'11111111-1111-4111-8111-111111111111','manager',now()+interval '1 day' FROM event_workspaces`);
  await rejected("DELETE FROM event_workspaces");
  await rejected("UPDATE event_memberships SET role='super_admin'");
  await rejected("UPDATE event_memberships SET expires_at=starts_at");
  await rejected(migration); // Deliberate fail-closed repeat; no partial changes.
  await db.exec('ROLLBACK');
  check((await db.query('SELECT count(*)::int AS n FROM event_workspaces')).rows[0].n === 1);
  check((await db.query('SELECT count(*)::int AS n FROM migration_log')).rows[0].n === 2);
  await db.exec("DELETE FROM user_profiles WHERE account_id='11111111-1111-4111-8111-111111111111'");
  check((await db.query('SELECT created_by FROM event_workspaces')).rows[0].created_by === null);
  check((await db.query('SELECT count(*)::int AS n FROM event_memberships')).rows[0].n === 0);
  console.log(`Event migration: ${checks} isolated Postgres checks passed.`);
} finally {
  await db.close();
}
