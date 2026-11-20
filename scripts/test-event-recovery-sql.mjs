// Ephemeral Postgres only: node scripts/test-event-recovery-sql.mjs <local-pglite-module>
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
if(!process.argv[2])throw Error('Supply a local PGlite module, never a database URL.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();let checks=0;
const check=v=>{assert.ok(v);checks++;};
const reject=async fn=>{await assert.rejects(fn);checks++;};
const id=n=>`${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const [admin,manager,staff,user,other,event,second,report,claim]=[1,2,3,4,5,6,7,8,9].map(id);
const secondClaim='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hash='a'.repeat(64),encrypted='encrypted-test-value-'.repeat(4);
const action=async (name,actor,version,data={},eid=event,cid=claim)=>(await db.query('SELECT event_claim_command($1,$2,$3,$4,$5,$6::jsonb) r',[eid,actor,cid,name,version,JSON.stringify(data)])).rows[0].r;
const manage=async (name,version,eid=event,actor=admin)=>(await db.query('SELECT event_manage_workspace($1,$2,$3,$4,$5) r',[eid,actor,version,name,'Reviewed event lifecycle and retained history'])).rows[0].r;
try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE TABLE user_profiles(account_id UUID PRIMARY KEY,access_level TEXT,is_active BOOLEAN,suspended_until TIMESTAMPTZ,verification_status TEXT,fname TEXT,lname TEXT);
CREATE TABLE migration_log(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ DEFAULT now(),note TEXT);
CREATE TABLE found_items(item_id INTEGER PRIMARY KEY,item_name TEXT);INSERT INTO found_items VALUES(1,'Campus sentinel');
CREATE SCHEMA storage;CREATE TABLE storage.buckets(id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT,allowed_mime_types TEXT[]);CREATE TABLE storage.objects(id UUID,bucket_id TEXT);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
INSERT INTO user_profiles VALUES('${admin}','super_admin',true,NULL,'verified','Admin','Person'),('${manager}','user',true,NULL,'verified','Manager','Person'),('${staff}','user',true,NULL,'verified','Staff','Person'),('${user}','user',true,NULL,'verified','Owner','Person'),('${other}','user',true,NULL,'verified','Other','Person');
INSERT INTO migration_log(name) VALUES('20261026_income_ledger_lock');GRANT SELECT,UPDATE ON user_profiles TO service_role;`);
for(const file of ['20261115_event_foundation','20261116_event_lifecycle','20261116b_event_reports','20261116c_event_recovery'])await db.exec(await readFile(new URL(`../Server/manual_migrations/${file}.sql`,import.meta.url),'utf8'));
await db.exec(`INSERT INTO event_workspaces(event_id,name,slug,organizer_name,venue,desk_instructions,starts_at,ends_at,recovery_ends_at,status,portal_enabled) VALUES('${event}','Event recovery','event-recovery','Campus','Gymnasium','Main desk',now()-interval '1 hour',now()+interval '1 hour',now()+interval '1 day','active',true),('${second}','Draft','draft-event','','','',NULL,NULL,NULL,'draft',false);
INSERT INTO event_memberships(event_id,account_id,role,expires_at) VALUES('${event}','${manager}','manager',now()+interval '1 day'),('${event}','${staff}','desk_staff',now()+interval '1 day');
INSERT INTO event_reports(report_id,event_id,reporter_account_id,request_id,board_consent,kind,item_name,category,description,venue,occurred_at,moderation_status,public_label) VALUES('${report}','${event}','${staff}',gen_random_uuid(),true,'found','Backpack','Bags & Luggage','Private distinguishing evidence','Gymnasium',now()-interval '10 minutes','approved','Blue backpack');`);
for(const role of ['anon','authenticated']){
for(const table of ['event_claims','event_claim_history'])check(!(await db.query(`SELECT has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') yes`)).rows[0].yes);
for(const signature of ['event_claim_command(uuid,uuid,uuid,text,integer,jsonb)','event_manage_workspace(uuid,uuid,integer,text,text)'])check(!(await db.query(`SELECT has_function_privilege('${role}','${signature}','EXECUTE') yes`)).rows[0].yes);
}
check(!(await db.query("SELECT has_table_privilege('service_role','event_claim_history','UPDATE,DELETE,TRUNCATE') yes")).rows[0].yes);
check((await db.query("SELECT count(*)::int n FROM pg_class WHERE oid IN('event_claims'::regclass,'event_claim_history'::regclass) AND relrowsecurity")).rows[0].n===2);
const payload={report_id:report,request_id:claim,evidence:'Private description of distinguishing ownership features.'};
await db.exec('SET ROLE service_role');
check(!(await action('create',staff,null,payload)).ok); // Finder cannot claim their own report.
check((await action('create',user,null,payload)).ok);
check((await action('create',user,null,payload)).replayed);
check(!(await action('create',user,null,{...payload,request_id:secondClaim},event,secondClaim)).ok);
check(!(await action('approve',staff,1,{note:'Checked ownership',pin_hash:hash,pin_encrypted:encrypted})).ok);
check(!(await action('approve',manager,1,{note:'Checked ownership',pin_hash:hash,pin_encrypted:encrypted})).ok); // Physical intake first.
check(!(await action('withdraw',other,1)).ok);
await db.exec('RESET ROLE');
await db.exec(`UPDATE event_reports SET received_at=now(),received_by='${staff}',storage_location='Bin A' WHERE report_id='${report}'`);
await db.exec('SET ROLE service_role');
check((await action('approve',manager,1,{note:'Ownership evidence checked',pin_hash:hash,pin_encrypted:encrypted})).ok);
check(!(await action('approve',manager,1,{note:'Stale decision refused',pin_hash:hash,pin_encrypted:encrypted})).ok);
check((await action('create',other,null,{...payload,request_id:secondClaim},event,secondClaim)).ok);
check(!(await action('approve',manager,1,{note:'Second winner must be refused',pin_hash:'b'.repeat(64),pin_encrypted:encrypted},event,secondClaim)).ok);
check(!(await action('release',user,2,{pin_hash:hash,note:'No self release',identity_checked:true})).ok);
check(!(await action('release',staff,2,{pin_hash:hash,note:'Identity check required',identity_checked:false})).ok);
check(!(await action('release',staff,2,{pin_hash:hash,note:'Wrong event refused',identity_checked:true},second)).ok);
for(let version=2;version<7;version++)check((await action('release',staff,version,{pin_hash:'f'.repeat(64),note:'Testing wrong pickup code',identity_checked:true})).code==='pin_incorrect');
check(!(await action('release',staff,7,{pin_hash:hash,note:'Locked code must not work',identity_checked:true})).ok);
check(!(await action('reset_pin',user,7,{pin_hash:'c'.repeat(64),pin_encrypted:encrypted})).ok); // One minute cooldown.
await db.exec('RESET ROLE');
await db.exec(`UPDATE event_claims SET pin_issued_at=now()-interval '2 minutes' WHERE claim_id='${claim}'`);
await db.exec('SET ROLE service_role');
check((await action('reset_pin',user,7,{pin_hash:'c'.repeat(64),pin_encrypted:encrypted})).ok);
check((await action('release',staff,8,{pin_hash:hash,note:'Old code is invalid after reset',identity_checked:true})).code==='pin_incorrect');
await db.exec('RESET ROLE');
await db.exec(`CREATE FUNCTION offline_fail_release_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='released' THEN RAISE check_violation USING MESSAGE='Offline atomicity failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER offline_fail_release_history BEFORE INSERT ON event_claim_history FOR EACH ROW EXECUTE FUNCTION offline_fail_release_history()`);
await db.exec('SET ROLE service_role');
check(!(await action('release',staff,9,{pin_hash:'c'.repeat(64),note:'Atomic failure must roll back release',identity_checked:true})).ok);
check((await db.query('SELECT released_at IS NULL yes FROM event_reports WHERE report_id=$1',[report])).rows[0].yes);
check((await db.query('SELECT version FROM event_claims WHERE claim_id=$1',[claim])).rows[0].version===9);
check((await db.query('SELECT status FROM event_claims WHERE claim_id=$1',[secondClaim])).rows[0].status==='pending');
await db.exec('RESET ROLE');
await db.exec('DROP TRIGGER offline_fail_release_history ON event_claim_history;DROP FUNCTION offline_fail_release_history()');
await db.exec('SET ROLE service_role');
const released=await action('release',staff,9,{pin_hash:'c'.repeat(64),note:'Verified identity and physically handed over item',identity_checked:true});
check(released.ok&&released.claim.status==='released'&&released.claim.recipient_name==='Owner Person');
check(released.claim.pin_hash===null&&released.claim.pin_encrypted===null);
check(!(await action('release',staff,10,{pin_hash:'c'.repeat(64),note:'Double release refused',identity_checked:true})).ok);
check((await db.query('SELECT status FROM event_claims WHERE claim_id=$1',[secondClaim])).rows[0].status==='rejected');
check((await db.query('SELECT released_at IS NOT NULL yes FROM event_reports WHERE report_id=$1',[report])).rows[0].yes);
await reject(()=>db.exec(`UPDATE event_reports SET released_at=NULL WHERE report_id='${report}'`));
check(!(await manage('delete',1)).ok); // Active event cannot be deleted.
check((await manage('delete',1,second)).ok);
check(!(await manage('restore',2,second,user)).ok);
check((await manage('restore',2,second)).ok);
check((await db.query('SELECT portal_enabled FROM event_workspaces WHERE event_id=$1',[second])).rows[0].portal_enabled===false);
await db.exec('RESET ROLE');
await db.exec(`UPDATE event_workspaces SET status='cancelled' WHERE event_id='${event}'`);
check((await manage('archive',1)).ok);
check((await manage('delete',2)).ok);
await reject(()=>db.exec(`UPDATE event_workspaces SET status='draft' WHERE event_id='${event}'`));
check((await manage('restore',3)).ok);
// Deletion cannot hide unreleased physical custody.
await db.exec(`INSERT INTO event_reports(event_id,reporter_account_id,request_id,kind,item_name,category,description,venue,occurred_at,received_at,storage_location) VALUES('${event}','${staff}',gen_random_uuid(),'found','Other item','Others','Retained custody must remain visible','Gymnasium',now(),now(),'Bin B')`);
check(!(await manage('delete',4)).ok);
// Expired pickup approval does not prevent the same owner from submitting fresh evidence.
await db.exec(`UPDATE event_workspaces SET status='active',starts_at=now()-interval '1 hour',ends_at=now()+interval '1 hour',recovery_ends_at=now()+interval '1 day',portal_enabled=true WHERE event_id='${second}';
INSERT INTO event_memberships(event_id,account_id,role,expires_at) VALUES('${second}','${manager}','manager',now()+interval '1 day');
INSERT INTO event_reports(report_id,event_id,reporter_account_id,request_id,board_consent,kind,item_name,category,description,venue,occurred_at,received_at,storage_location,moderation_status,public_label) VALUES('${manager}','${second}','${staff}',gen_random_uuid(),true,'found','Jacket','Clothing','Private details of jacket ownership','Gymnasium',now(),now(),'Bin C','approved','Blue jacket')`);
check((await action('create',user,null,{...payload,report_id:manager,request_id:user},second,user)).ok);
check((await action('approve',manager,1,{note:'First owner evidence checked',pin_hash:hash,pin_encrypted:encrypted},second,user)).ok);
await db.exec(`UPDATE event_claims SET pickup_expires_at=now()-interval '1 minute' WHERE claim_id='${user}'`);
check((await action('create',user,null,{...payload,report_id:manager,request_id:other},second,other)).ok);
check((await db.query('SELECT status FROM event_claims WHERE claim_id=$1',[user])).rows[0].status==='expired');
check((await action('create',manager,null,{...payload,report_id:manager,request_id:staff},second,staff)).ok);
check(!(await action('approve',manager,1,{note:'Manager cannot review own claim',pin_hash:hash,pin_encrypted:encrypted},second,staff)).ok);
check((await action('approve',manager,1,{note:'Fresh evidence checked again',pin_hash:hash,pin_encrypted:encrypted},second,other)).ok);
await db.exec(`UPDATE event_workspaces SET status='closed',portal_enabled=false WHERE event_id='${second}'`);
check((await db.query("SELECT count(*)::int n FROM event_claims WHERE event_id=$1 AND status IN('pending','approved')",[second])).rows[0].n===0);
check((await db.query("SELECT pin_hash IS NULL AND pin_encrypted IS NULL yes FROM event_claims WHERE claim_id=$1",[other])).rows[0].yes);
// Foreign-key anonymization must still work for retained deleted/released records.
await db.exec(`UPDATE event_workspaces SET created_by='${admin}' WHERE event_id='${event}';UPDATE event_reports SET released_by=NULL,received_by=NULL,reporter_account_id=NULL WHERE report_id='${report}'`);
check((await db.query('SELECT reporter_account_id IS NULL yes FROM event_reports WHERE report_id=$1',[report])).rows[0].yes);
const deletedDraft='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
await db.exec(`INSERT INTO event_workspaces(event_id,name,slug,created_by) VALUES('${deletedDraft}','Deleted draft','deleted-draft','${admin}')`);
check((await manage('delete',1,deletedDraft)).ok);
await reject(()=>db.exec(`SELECT event_transition('${deletedDraft}','${admin}',2,'cancelled','Deleted drafts cannot change lifecycle')`));
await db.exec(`DELETE FROM user_profiles WHERE account_id IN ('${staff}','${admin}')`);
check((await db.query('SELECT created_by IS NULL yes FROM event_workspaces WHERE event_id=$1',[deletedDraft])).rows[0].yes);
check((await db.query('SELECT received_by IS NULL AND released_by IS NULL yes FROM event_reports WHERE report_id=$1',[report])).rows[0].yes);
check((await db.query('SELECT item_name FROM found_items')).rows[0].item_name==='Campus sentinel');
const migration=await readFile(new URL('../Server/manual_migrations/20261116c_event_recovery.sql',import.meta.url),'utf8');
await reject(()=>db.exec(migration));await db.exec('ROLLBACK');
check((await db.query('SELECT count(*)::int n FROM event_claims')).rows[0].n===5);
console.log(`Event recovery: ${checks} isolated Postgres checks passed.`);
}catch(error){console.error(error.message,error.where||'',error.stack?.split('\n').slice(0,3).join('\n'));process.exitCode=1;}finally{await db.close();}
