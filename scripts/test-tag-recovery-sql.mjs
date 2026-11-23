// Offline only. The argument is an installed PGlite module file. No database URL is accepted.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const combined = await readFile(new URL("../Server/manual_migrations/20261123_campus_venues.sql", import.meta.url),"utf8");
assert.equal((combined.match(/^BEGIN;/gm) || []).length,1);
assert.equal((combined.match(/^COMMIT;/gm) || []).length,1);
const migration = async name => db.exec(await readFile(new URL("../Server/manual_migrations/" + name + ".sql", import.meta.url), "utf8"));
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const owner = randomUUID(), staff = randomUUID(), item = randomUUID();
const tag = "ABCDEFGHJK23", key = randomUUID();
const point = {latitude: 14.55, longitude: 121.06, accuracy: 12, captured_at: new Date().toISOString(), consent_version: "finder-v1"};
const submit = (request, gps = null) => scalar("SELECT tag_recovery_submit($1,$2,$3,$4,$5,$6::jsonb)", [tag, request, "HPSB / 6F / Room 606", "Private note", "Private contact", JSON.stringify(gps)]);
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid,bucket_id text);
    CREATE TABLE migration_log(name text primary key,note text,applied_at timestamptz default now());
    INSERT INTO migration_log(name) VALUES('20261026_income_ledger_lock');
    CREATE TABLE user_profiles(account_id uuid primary key,access_level text,is_active boolean,suspended_until timestamptz);
    CREATE TABLE smart_tags(tag_id varchar(12) primary key,owner_account_id uuid,status text,is_disabled boolean,valid_until timestamptz,item_name text,last_found_notice_at timestamptz,found_notice_count int default 0,claimed_at timestamptz default now());
    CREATE TABLE found_items(item_id uuid primary key,account_id uuid,smart_tag_id text,custody_status text,created_at timestamptz default now(),status text default 'unclaimed');
    CREATE TABLE claims(found_item_id uuid,claimant_account_id uuid,status text,collected_at timestamptz,released_by uuid);
    GRANT SELECT ON migration_log TO service_role;
    GRANT SELECT, INSERT, UPDATE ON smart_tags,found_items,claims,user_profiles TO service_role;`);
  for (const name of ["20261115_event_foundation","20261116_event_lifecycle","20261116b_event_reports"]) await migration(name);
  await db.query("INSERT INTO user_profiles VALUES($1,'user',true,null),($2,'super_admin',true,null)",[owner,staff]);
  const event = randomUUID();
  await db.query(`INSERT INTO event_workspaces(event_id,name,slug,organizer_name,desk_instructions,venue,starts_at,ends_at,recovery_ends_at)
    VALUES($1,'Fixture Event','fixture-event','Campus','Desk at entrance','Library',now()+interval '1 hour',now()+interval '2 hours',now()+interval '1 day')`,[event]);
  await db.query("INSERT INTO event_memberships(event_id,account_id,role,expires_at) VALUES($1,$2,'manager',now()+interval '2 days')",[event,owner]);
  const eventReport = venue => db.query(`INSERT INTO event_reports(event_id,reporter_account_id,request_id,kind,item_name,category,description,venue,occurred_at)
    VALUES($1,$2,gen_random_uuid(),'found','Keys','Keys','Synthetic test keys',$3,now())`,[event,owner,venue]);
  await eventReport("Library");
  await db.query("INSERT INTO smart_tags(tag_id,owner_account_id,status,is_disabled,item_name) VALUES($1,$2,'active',false,'Keys')",[tag,owner]);
  for (let run = 0; run < 2; run++) {
    await migration("20261123_campus_venues");
    await migration("20261123b_smart_tag_recovery");
  }
  const catalogue = JSON.parse(await readFile(new URL("../shared/campus.json",import.meta.url)));
  const expected = [...catalogue.legacy];
  for (const [building,floors] of Object.entries(catalogue.buildings)) {
    expected.push(building);
    for(const [floor,rooms] of Object.entries(floors)) expected.push(building+" / "+floor,...rooms.map(room=>[building,floor,room].join(" / ")));
  }
  assert.deepEqual((await db.query("SELECT label FROM campus_venues")).rows.map(r=>r.label).sort(),expected.sort());
  for (const role of ["anon","authenticated"]) {
    for(const table of ["tag_recovery_reports","tag_recovery_points","campus_venues"])
      assert.equal(await scalar("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE')",[role,table]),false);
    assert.equal(await scalar("SELECT has_function_privilege($1,'tag_recovery_submit(text,uuid,text,text,text,jsonb)','EXECUTE')",[role]),false);
  }
  await db.exec("SET ROLE service_role");
  assert.equal(await scalar("SELECT venue FROM event_reports"),"Library");
  await db.query("UPDATE event_workspaces SET venue=$1 WHERE event_id=$2",["HPSB / 6F / Room 606",event]);
  const transition = await scalar("SELECT event_transition($1,$2,1,'scheduled','Reviewed university venue')",[event,staff]);
  assert.equal(transition.ok,true);
  await eventReport("HPSB / 6F / Room 606");
  await assert.rejects(() => eventReport("Unknown location"));
  const first = await submit(key,point);
  assert.equal(first.state,"saved");
  assert.equal((await submit(key,point)).state,"duplicate");
  assert.equal((await submit(randomUUID())).state,"cooldown");
  assert.equal(await scalar("SELECT found_notice_count FROM smart_tags"),1);
  assert.equal(await scalar("SELECT count(*)::int FROM tag_recovery_points WHERE expires_at BETWEEN now()+interval '6 days' AND now()+interval '8 days'"),1);
  await db.query("INSERT INTO found_items VALUES($1,$2,$3,'turned_over')",[item,staff,tag]);
  assert.equal(await scalar("SELECT received_at IS NOT NULL FROM tag_recovery_reports"),true);
  await db.exec("UPDATE smart_tags SET last_found_notice_at=null");
  assert.equal((await submit(randomUUID(),point)).state,"saved");
  assert.equal(await scalar("SELECT count(*)::int FROM tag_recovery_reports WHERE received_at IS NOT NULL"),2);
  await db.query("INSERT INTO claims VALUES($1,$2,'approved',null,null)",[item,owner]);
  assert.equal(await scalar("SELECT returned_at IS NULL FROM tag_recovery_reports"),true);
  await db.query("UPDATE claims SET status='collected',collected_at=now(),released_by=$1",[staff]);
  assert.equal(await scalar("SELECT returned_at IS NOT NULL FROM tag_recovery_reports"),true);
  assert.equal(await scalar("SELECT count(*)::int FROM tag_recovery_points"),0);
  await db.exec("UPDATE smart_tags SET last_found_notice_at=null");
  assert.equal((await submit(randomUUID())).state,"saved");
  assert.equal(await scalar("SELECT count(*)::int FROM tag_recovery_points"),0);
  await db.exec("UPDATE smart_tags SET last_found_notice_at=null,is_disabled=true");
  assert.equal((await submit(randomUUID())).state,"inactive");
  await db.exec("UPDATE smart_tags SET is_disabled=false,valid_until=now()-interval '1 hour'");
  assert.equal((await submit(randomUUID())).state,"inactive");
  await db.exec("UPDATE smart_tags SET valid_until=null;UPDATE campus_venues SET active=false WHERE label='HPSB / 6F / Room 606'");
  assert.equal((await submit(randomUUID())).state,"venue_unavailable");
  assert.equal(await scalar("SELECT count(*)::int FROM tag_recovery_reports"),3);
  assert.equal(await scalar("SELECT count(*)::int FROM migration_log WHERE name LIKE '20261123%'"),2);
  await db.exec("RESET ROLE");
  await migration("20261123_campus_venues");
  await migration("20261123_campus_venues");
  for (const role of ["anon","authenticated"])
    assert.equal(await scalar("SELECT has_function_privilege($1,'campus_venue_manage(uuid,text,text,text,boolean,integer)','EXECUTE')",[role]),false);
  await db.exec("SET ROLE service_role");
  const manage = (action,label,target,version=1,actor=staff,active=true) =>
    scalar("SELECT campus_venue_manage($1,$2,$3,$4,$5,$6)",[actor,action,label,target,active,version]);
  assert.equal((await manage("create","","New Hall",0,owner)).ok,false);
  assert.equal((await manage("create","","New Hall",0)).ok,true);
  assert.equal((await manage("create","","New Hall / 1F",0)).ok,true);
  assert.equal((await manage("create","","New Hall / 1F / Room 100",0)).ok,true);
  assert.equal((await manage("create","","new hall",0)).ok,false);
  assert.equal((await manage("create","","Missing / 1F",0)).ok,false);
  assert.equal((await manage("create","","New Hall / 1F / Room 101 / Extra",0)).ok,false);
  assert.equal((await manage("rename","Library","New Library")).ok,false);
  assert.equal((await manage("rename","New Hall","West Hall",99)).ok,false);
  assert.equal((await manage("rename","New Hall","West Hall")).ok,true);
  assert.equal(await scalar("SELECT active FROM campus_venues WHERE label='New Hall'"),false);
  assert.equal(await scalar("SELECT campus_venue_available('West Hall / 1F / Room 100')"),true);
  assert.equal((await manage("availability","West Hall","",1,staff,false)).ok,true);
  assert.equal(await scalar("SELECT campus_venue_available('West Hall / 1F / Room 100')"),false);
  assert.equal((await manage("availability","West Hall","",1)).ok,false);
  assert.equal(await scalar("SELECT count(*)::int FROM campus_venue_history"),5);
  assert.equal(await scalar("SELECT count(*)::int FROM tag_recovery_reports"),3);
  console.log("Passed: event dependencies, migration reruns, grants, recovery/custody, catalogue parity, venue create/rename/retire, parent checks, stale edits, role restrictions and historical preservation.");
} finally { await db.close(); }
