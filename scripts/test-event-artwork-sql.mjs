// In-memory migration tests; pass only a local PGlite module path.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
if (!process.argv[2]) throw new Error('Supply the local PGlite module path.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const check = (value) => { assert.ok(value); checks++; };
const rejected = async (sql) => { let failed = false; try { await db.exec(sql); } catch { failed = true; } check(failed); };
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE user_profiles(account_id UUID PRIMARY KEY);
    CREATE TABLE migration_log(name VARCHAR(160) PRIMARY KEY,applied_at TIMESTAMPTZ DEFAULT now(),note TEXT);
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT,allowed_mime_types TEXT[]);
    CREATE TABLE storage.objects(id UUID PRIMARY KEY,bucket_id TEXT);
    INSERT INTO storage.buckets VALUES ('found-item-images','found-item-images',true,NULL,NULL);
    INSERT INTO user_profiles VALUES ('11111111-1111-4111-8111-111111111111');`);
  await db.exec(await readFile(new URL('../Server/manual_migrations/20261115_event_foundation.sql', import.meta.url), 'utf8'));
  await db.exec("INSERT INTO event_workspaces(event_id,name,slug) VALUES ('22222222-2222-4222-8222-222222222222','Pilot','pilot')");
  const migration = await readFile(new URL('../Server/manual_migrations/20261115b_event_brand_assets.sql', import.meta.url), 'utf8');
  await db.exec('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE POLICY broad_browser ON storage.objects FOR SELECT TO authenticated USING (true)');
  await rejected(migration);
  await db.exec('ROLLBACK');
  check((await db.query("SELECT to_regclass('public.event_brand_assets')::text AS name")).rows[0].name === null);
  check((await db.query("SELECT count(*)::int AS n FROM storage.buckets WHERE id='event-brand-assets'")).rows[0].n === 0);
  await db.exec('DROP POLICY broad_browser ON storage.objects'); // Only the synthetic fixture policy.
  await db.exec(migration);
  check((await db.query("SELECT public FROM storage.buckets WHERE id='event-brand-assets'")).rows[0].public === false);
  check((await db.query("SELECT public FROM storage.buckets WHERE id='found-item-images'")).rows[0].public === true);
  check((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='event_brand_assets'::regclass")).rows[0].relrowsecurity);
  for (const role of ['anon', 'authenticated']) check(!(await db.query(`SELECT has_table_privilege('${role}','event_brand_assets','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed`)).rows[0].allowed);
  check(!(await db.query("SELECT has_table_privilege('service_role','event_brand_assets','DELETE,TRUNCATE') AS allowed")).rows[0].allowed);
  await db.exec("INSERT INTO event_brand_assets(event_id,kind,object_path,updated_by) VALUES ('22222222-2222-4222-8222-222222222222','logo','22222222-2222-4222-8222-222222222222/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp','11111111-1111-4111-8111-111111111111')");
  await rejected("UPDATE event_brand_assets SET object_path='../../campus/file.webp'");
  await rejected("UPDATE event_brand_assets SET kind='report'");
  await rejected("UPDATE event_brand_assets SET revision=0");
  await rejected("DELETE FROM event_workspaces");
  await rejected("INSERT INTO event_brand_assets(event_id,kind) VALUES ('22222222-2222-4222-8222-222222222222','logo')");
  await db.exec('UPDATE event_brand_assets SET object_path=NULL,revision=2');
  check((await db.query('SELECT revision FROM event_brand_assets')).rows[0].revision === 2);
  await rejected(migration);
  await db.exec('ROLLBACK');
  check((await db.query('SELECT count(*)::int AS n FROM event_brand_assets')).rows[0].n === 1);
  await db.exec('DELETE FROM user_profiles');
  check((await db.query('SELECT updated_by FROM event_brand_assets')).rows[0].updated_by === null);
  console.log(`Event artwork migration: ${checks} isolated Postgres checks passed.`);
} finally { await db.close(); }
