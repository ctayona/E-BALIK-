// Run against ephemeral Postgres only: node scripts/test-event-reports-sql.mjs <local-pglite-module>
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
if (!process.argv[2]) throw Error('Supply a local PGlite module path, never a database URL.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite(); let checks = 0;
const check = (value) => { assert.ok(value); checks++; };
const rejected = async (fn) => { await assert.rejects(fn); checks++; };
const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const [admin, manager, staff, user, other, event, second, report, request] = [1,2,3,4,5,6,7,8,9].map(id);
const count = async table => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
const command = async (action, actor, version, data={}, eid=event, rid=report) => (await db.query('SELECT event_report_command($1,$2,$3,$4,$5,$6::jsonb) AS r',[eid,actor,rid,action,version,JSON.stringify(data)])).rows[0].r;
const portal = async (enabled, version, actor=admin) => (await db.query('SELECT event_set_portal($1,$2,$3,$4,$5) AS r',[event,actor,version,enabled,'Reviewed event audience and branding'])).rows[0].r;
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE user_profiles(account_id UUID PRIMARY KEY,access_level TEXT,is_active BOOLEAN,suspended_until TIMESTAMPTZ,verification_status TEXT);
    CREATE TABLE migration_log(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ DEFAULT now(),note TEXT);
    CREATE TABLE found_items(item_id INTEGER PRIMARY KEY,item_name TEXT); INSERT INTO found_items VALUES(1,'Campus sentinel');
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT,allowed_mime_types TEXT[]);
    CREATE TABLE storage.objects(id UUID,bucket_id TEXT); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    INSERT INTO user_profiles VALUES('${admin}','super_admin',true,NULL,'verified'),('${manager}','user',true,NULL,'verified'),('${staff}','user',true,NULL,'verified'),('${user}','user',true,NULL,'verified'),('${other}','user',true,NULL,'verified');
    INSERT INTO migration_log(name) VALUES('20261026_income_ledger_lock'); GRANT SELECT,UPDATE ON user_profiles TO service_role;`);
  for (const name of ['20261115_event_foundation','20261116_event_lifecycle']) await db.exec(await readFile(new URL(`../Server/manual_migrations/${name}.sql`, import.meta.url),'utf8'));
  await db.exec(`INSERT INTO event_workspaces(event_id,name,slug,organizer_name,venue,desk_instructions,starts_at,ends_at,recovery_ends_at,status)
    VALUES('${event}','Campus Day','campus-day','Student council','Gymnasium','Main entrance',now()-interval '1 hour',now()+interval '1 hour',now()+interval '1 day','active'),
    ('${second}','Other Event','other-event','Council','Library','Desk',now()-interval '1 hour',now()+interval '1 hour',now()+interval '1 day','active');
    INSERT INTO event_memberships(event_id,account_id,role,expires_at) VALUES('${event}','${manager}','manager',now()+interval '1 day'),('${event}','${staff}','desk_staff',now()+interval '1 day');`);
  const migration=await readFile(new URL('../Server/manual_migrations/20261116b_event_reports.sql',import.meta.url),'utf8');
  await db.exec('CREATE POLICY synthetic_broad ON storage.objects FOR SELECT TO authenticated USING(true)');
  await rejected(()=>db.exec(migration)); await db.exec('ROLLBACK');
  check((await db.query("SELECT to_regclass('event_reports')::text AS t")).rows[0].t===null);
  await db.exec('DROP POLICY synthetic_broad ON storage.objects'); await db.exec(migration);
  check((await db.query('SELECT portal_enabled FROM event_workspaces LIMIT 1')).rows[0].portal_enabled===false);
  check((await db.query("SELECT public FROM storage.buckets WHERE id='event-report-images'")).rows[0].public===false);
  for (const role of ['anon','authenticated']) {
    for(const table of ['event_reports','event_report_history']) check(!(await db.query(`SELECT has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS yes`)).rows[0].yes);
    for(const signature of ['event_set_portal(uuid,uuid,integer,boolean,text)','event_report_command(uuid,uuid,uuid,text,integer,jsonb)']) check(!(await db.query(`SELECT has_function_privilege('${role}','${signature}','EXECUTE') AS yes`)).rows[0].yes);
  }
  check((await db.query("SELECT count(*)::int n FROM pg_class WHERE oid IN ('event_reports'::regclass,'event_report_history'::regclass) AND relrowsecurity")).rows[0].n===2);
  check(!(await db.query("SELECT has_table_privilege('service_role','event_report_history','UPDATE,DELETE,TRUNCATE') AS yes")).rows[0].yes);
  const incident=new Date(Date.now()-15*60000).toISOString();
  const data={board_consent:true,request_id:request,kind:'found',item_name:'Black backpack',category:'Bags & Luggage',description:'Private distinguishing features for ownership verification.',venue:'Gymnasium',location_details:'Beside the entrance',occurred_at:incident};
  check(!(await command('create',user,null,data)).ok);
  check(!(await command('create',user,null,{...data,board_consent:false})).ok);
  check(!(await portal(true,1,manager)).ok);
  check(!(await portal(true,9)).ok);
  check((await portal(true,1)).ok);
  check(await count('event_state_history')===1);
  await db.exec('SET ROLE service_role');
  const created=await command('create',user,null,data); check(created.ok && created.report.moderation_status==='pending' && created.report.received_at===null);
  check((await command('create',user,null,data)).replayed===true);
  check(await count('event_reports')===1 && await count('event_report_history')===1);
  check(!(await command('receive',staff,1,{note:'Physical item received',storage_location:'Shelf A'},second)).ok);
  check(!(await command('approve',staff,1,{note:'Reviewed safe label',public_label:'Black backpack'})).ok);
  check(!(await command('approve',manager,1,{note:'Reviewed safe label',public_label:'student@example.test'})).ok);
  check(!(await command('approve',manager,1,{note:'Reviewed safe label',public_label:'ID 12345678'})).ok);
  check((await command('approve',manager,1,{note:'Reviewed generic item label',public_label:'Black backpack'})).ok);
  check(!(await command('receive',staff,1,{note:'Physical item received',storage_location:'Shelf A'})).ok);
  check((await command('receive',staff,2,{note:'Physical item received at desk',storage_location:'Shelf A, bin 3'})).ok);
  check(!(await command('receive',staff,3,{note:'Duplicate receipt prevented',storage_location:'Shelf B'})).ok);
  check(!(await command('withdraw',user,3)).ok);
  check((await command('note',staff,3,{note:'Dry bag placed in secure storage'})).ok);
  check((await command('hide',manager,4,{note:'Temporarily hidden for privacy review'})).ok);
  check(!(await command('note',other,5,{note:'Unauthorized account'})).ok);
  check(!(await command('unknown',manager,5,{note:'Unsupported action'})).ok);
  await db.exec('RESET ROLE');
  await db.exec(`UPDATE event_memberships SET status='revoked' WHERE account_id='${staff}'`);
  check(!(await command('note',staff,5,{note:'Revoked staff account'})).ok);
  await db.exec(`UPDATE user_profiles SET is_active=false WHERE account_id='${manager}'`);
  check(!(await command('note',manager,5,{note:'Suspended staff account'})).ok);
  const missingId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const missing=await command('create',other,null,{...data,request_id:missingId,kind:'missing'},event,missingId);
  check(missing.ok);
  check((await command('withdraw',other,1,{},event,missingId)).ok);
  check(!(await command('create',user,null,{...data,request_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',occurred_at:'2099-01-01T00:00:00Z'},event,'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).ok);
  check((await portal(false,2)).ok);
  check(!(await command('create',user,null,{...data,request_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},event,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).ok);
  check((await db.query('SELECT item_name FROM found_items')).rows[0].item_name==='Campus sentinel');
  await rejected(()=>db.exec(migration)); await db.exec('ROLLBACK'); check(await count('event_reports')===2);
  await db.exec(`UPDATE user_profiles SET is_active=true WHERE account_id='${manager}';
    CREATE FUNCTION fail_event_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic history failure'; END $$;
    CREATE TRIGGER fail_event_history BEFORE INSERT ON event_report_history FOR EACH ROW EXECUTE FUNCTION fail_event_history();`);
  await rejected(()=>command('note',manager,5,{note:'Must roll back the report version'}));
  check((await db.query('SELECT version FROM event_reports WHERE report_id=$1',[report])).rows[0].version===5);
  await db.exec('DROP TRIGGER fail_event_history ON event_report_history');
  await db.exec(`UPDATE event_workspaces SET ends_at=now()-interval '1 minute',recovery_ends_at=now()-interval '30 seconds' WHERE event_id='${event}'`);
  check(!(await command('note',manager,5,{note:'Deadline must refuse further intake'})).ok);
  await db.exec(`UPDATE event_workspaces SET ends_at=now()+interval '1 hour',recovery_ends_at=now()+interval '2 hours' WHERE event_id='${event}';
    INSERT INTO event_reports(event_id,reporter_account_id,request_id,kind,item_name,category,description,venue,occurred_at)
    SELECT '${event}','${user}',gen_random_uuid(),'missing','Quota fixture','Others','Synthetic quota fixture description','Gymnasium',now()-interval '10 minutes' FROM generate_series(1,24);`);
  // Staff can intake while the portal is paused, but ordinary attendees cannot. Reopen for quota assertion.
  check((await portal(true,3)).ok);
  check(!(await command('create',user,null,{...data,request_id:'ffffffff-ffff-4fff-8fff-ffffffffffff'},event,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).ok);
  check((await db.query('SELECT count(*)::int AS n FROM event_reports WHERE reporter_account_id=$1',[user])).rows[0].n===25);
  console.log(`Event reports: ${checks} isolated Postgres checks passed.`);
} finally { await db.close(); }
