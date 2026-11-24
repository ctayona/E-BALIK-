// Local WASM PostgreSQL only. Do not accept a database connection string.
import assert from "node:assert/strict"
import { randomUUID as id } from "node:crypto"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
const { PGlite } = await import(pathToFileURL(process.argv[2]).href)
const db = new PGlite()
const [admin, manager, owner, next, receiver, event, second] = Array.from(
  { length: 7 },
  () => id(),
)
const migrate = async (name) =>
  db.exec(
    await readFile(
      new URL("../Server/manual_migrations/" + name + ".sql", import.meta.url),
      "utf8",
    ),
  )
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const command = async (actor, action, data = {}, options = {}) =>
  (
    await first(
      "SELECT event_tag_command($1,$2,$3,$4,$5,$6,$7,$8::jsonb) AS result",
      [
        actor,
        action,
        options.request ?? id(),
        options.event ?? null,
        options.code ?? null,
        options.session ?? null,
        options.version ?? null,
        JSON.stringify(data),
      ],
    )
  ).result
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid,bucket_id text);
 CREATE TABLE migration_log(name text primary key,note text,applied_at timestamptz default now());
 CREATE TABLE user_profiles(account_id uuid primary key,access_level text,is_active boolean,suspended_until timestamptz,verification_status text,fname text,lname text);
 GRANT SELECT,UPDATE ON user_profiles TO service_role;
 INSERT INTO migration_log(name) VALUES('20261026_income_ledger_lock');`)
  for (const name of [
    "20261115_event_foundation",
    "20261116_event_lifecycle",
    "20261116b_event_reports",
    "20261116c_event_recovery",
    "20261117_event_match_alerts",
    "20261118_event_pilot_completion",
    "20261123_campus_venues",
  ])
    await migrate(name)
  for (let i = 0; i < 2; i++) await migrate("20261124_event_smart_tags")
  for (const [actor, role] of [
    [admin, "super_admin"],
    [manager, "user"],
    [owner, "user"],
    [next, "user"],
    [receiver, "guard"],
  ])
    await db.query(
      "INSERT INTO user_profiles VALUES($1,$2,true,null,'verified','Test','Person')",
      [actor, role],
    )
  for (const eid of [event, second])
    await db.query(
      `INSERT INTO event_workspaces(event_id,name,slug,organizer_name,venue,desk_instructions,starts_at,ends_at,recovery_ends_at,status,portal_enabled)
 VALUES($1,'Fixture event',$2,'Campus','Gymnasium','Main entrance',now()-interval '1 hour',now()+interval '2 hours',now()+interval '1 day','active',true)`,
      [eid, "test-" + eid],
    )
  await db.query(
    "INSERT INTO event_memberships(event_id,account_id,role,expires_at) VALUES($1,$2,'manager',now()+interval '1 day')",
    [event, manager],
  )
  assert.equal(
    (
      await first(
        "SELECT has_table_privilege('authenticated','event_tag_registrations','SELECT') AS allowed",
      )
    ).allowed,
    false,
  )
  await db.exec("SET ROLE service_role")
  const issue = { request: id() }
  const batch = await command(
    admin,
    "issue",
    { count: 2, label: "Theatre" },
    issue,
  )
  assert.equal(
    (await command(admin, "issue", { count: 2, label: "Theatre" }, issue))
      .batch_id,
    batch.batch_id,
  )
  await assert.rejects(command(owner, "issue", { count: 1, label: "Invalid" }))
  const { code } = await first(
    "SELECT code FROM event_tags WHERE batch_id=$1",
    [batch.batch_id],
  )
  const opts = { event, code, version: 1 }
  await assert.rejects(
    command(admin, "desk", { enabled: true }, { event, version: 0 }),
  )
  const extra = await first(
    "SELECT code FROM event_tags WHERE batch_id=$1 AND code<>$2",
    [batch.batch_id, code],
  )
  const subset = {
    batch_id: batch.batch_id,
    tags: [
      { code: extra.code, version: 1 },
      { code, version: 99 },
    ],
  }
  await assert.rejects(command(admin, "assign_batch", subset, { event }))
  assert.equal(
    (await first("SELECT count(*)::int AS n FROM event_tag_allocations")).n,
    0,
  )
  await command(
    admin,
    "assign_batch",
    { ...subset, tags: subset.tags.slice(0, 1) },
    { event: second },
  )
  await command(admin, "assign", {}, opts)
  await assert.rejects(command(admin, "assign", {}, { ...opts, event: second }))
  await command(admin, "desk", { enabled: true }, { event, version: 0 })
  const alloc = await first(
    "SELECT allocation_id FROM event_tag_allocations WHERE code=$1",
    [code],
  )
  const data = {
    ...alloc,
    item_name: "Water bottle",
    description: "Blue insulated bottle",
    photo_path: "private-fixture",
  }
  const request = id(),
    regOpts = { event, code, version: 2, request }
  const results = await Promise.allSettled([
    command(owner, "register", data, regOpts),
    command(next, "register", data, { ...regOpts, request: id() }),
  ])
  assert.deepEqual(
    results.map((r) => r.status),
    ["fulfilled", "rejected"],
  )
  const session = results[0].value.registration_id
  assert.equal(
    (await command(owner, "register", data, regOpts)).registration_id,
    session,
  )
  const act = (actor, action, version, data = {}, request = id()) =>
    command(actor, action, data, { event, code, session, version, request })
  await assert.rejects(
    act(next, "receive", 1, { storage: "A1", hash: "old", cipher: "secret" }),
  )
  await assert.rejects(
    command(admin, "unassign", {}, { event, code, version: 3 }),
  )
  await assert.rejects(
    act(owner, "receive", 1, { storage: "A1", hash: "no", cipher: "no" }),
  )
  await assert.rejects(act(next, "cancel", 1))
  await act(manager, "receive", 1, {
    storage: "Shelf A1",
    hash: "old",
    cipher: "secret",
    fingerprint: "first-pin",
  })
  await assert.rejects(
    act(manager, "escalate", 2, { reason: "No permission yet" }),
  )
  await act(owner, "consent", 2, { allowed: true })
  await act(manager, "escalate", 3, {
    reason: "Bottle missing during shelf check",
  })
  assert.equal(
    (await first("SELECT moderation_status FROM event_reports"))
      .moderation_status,
    "pending",
  )
  await act(manager, "transfer", 4, {
    receiver_id: receiver,
    destination: "Main office",
  })
  await assert.rejects(
    act(manager, "collect", 5, { identity_checked: true, hash: "old" }),
  )
  await assert.rejects(act(next, "accept", 5, { storage: "Wrong desk" }))
  await act(receiver, "accept", 5, { storage: "Office shelf 2" })
  await db.query(
    "UPDATE event_workspaces SET status='closed',portal_enabled=false WHERE event_id=$1",
    [event],
  )
  await assert.rejects(
    db.query(
      "UPDATE event_workspaces SET status='archived' WHERE event_id=$1",
      [event],
    ),
  )
  await assert.rejects(
    db.query("UPDATE event_workspaces SET deleted_at=now() WHERE event_id=$1", [
      event,
    ]),
  )
  await assert.rejects(
    db.query(
      "INSERT INTO event_closure_plans(event_id,completed_at,completed_by) VALUES($1,now(),$2)",
      [event, admin],
    ),
  )
  assert.equal(
    (await first("SELECT event_tag_counts($1) AS counts", [event])).counts
      .tag_office,
    1,
  )
  await assert.rejects(command(admin,'unassign_batch',{batch_id:batch.batch_id,tags:[{code,version:3}]},{event}));
  await command(admin,'unassign_batch',{batch_id:batch.batch_id,tags:[{code:extra.code,version:2}]},{event:second});
  const retry = id()
  assert.equal(
    (
      await act(
        receiver,
        "collect",
        6,
        { identity_checked: true, hash: "wrong" },
        retry,
      )
    ).outcome,
    "invalid_pin",
  )
  assert.equal(
    (
      await act(
        receiver,
        "collect",
        6,
        { identity_checked: true, hash: "wrong" },
        retry,
      )
    ).replay,
    true,
  )
  await act(receiver, "collect", 7, { identity_checked: true, hash: "old" })
  await command(admin, "unassign", {}, { event, code, version: 3 })
  await command(admin, "assign", {}, { event: second, code, version: 4 })
  await command(admin, "desk", { enabled: true }, { event: second, version: 0 })
  await assert.rejects(
    command(next, "register", data, { event: second, code, version: 5 }),
  )
  const allocation = await first(
    "SELECT allocation_id FROM event_tag_allocations WHERE code=$1 AND ended_at IS NULL",
    [code],
  )
  const reuse = await command(
    next,
    "register",
    { ...data, ...allocation, photo_path: "private-second" },
    { event: second, code, version: 5 },
  )
  const later = { event: second, code, session: reuse.registration_id }
  await assert.rejects(
    command(
      admin,
      "receive",
      {
        storage: "Shelf B",
        hash: "new",
        cipher: "cipher",
        fingerprint: "first-pin",
      },
      { ...later, version: 1 },
    ),
  )
  await command(
    admin,
    "receive",
    {
      storage: "Shelf B",
      hash: "new",
      cipher: "new-secret",
      fingerprint: "second-pin",
    },
    { ...later, version: 1 },
  )
  assert.equal(
    (
      await command(admin, "collect", { identity_checked: true, hash: "old" }, {
        ...later,
        version: 2,
      })
    ).outcome,
    "invalid_pin",
  )
  assert.equal(
    (
      await first(
        "SELECT status FROM event_tag_registrations WHERE registration_id=$1",
        [session],
      )
    ).status,
    "collected",
  )
  for (let version = 3; version <= 6; version++)
    assert.equal(
      (
        await command(
          admin,
          "collect",
          { identity_checked: true, hash: "bad" },
          { ...later, version },
        )
      ).outcome,
      "invalid_pin",
    )
  await assert.rejects(
    command(admin, "collect", { identity_checked: true, hash: "new" }, {
      ...later,
      version: 7,
    }),
  )
  await assert.rejects(
    command(
      next,
      "reset_pin",
      { hash: "third", cipher: "third", fingerprint: "third-pin" },
      { ...later, version: 7 },
    ),
  )
  await db.query(
    "UPDATE event_tag_registrations SET pin_at=now()-interval '25 hours' WHERE registration_id=$1",
    [later.session],
  )
  await command(
    next,
    "reset_pin",
    { hash: "third", cipher: "third", fingerprint: "third-pin" },
    { ...later, version: 7 },
  )
  await command(admin, "collect", { identity_checked: true, hash: "third" }, {
    ...later,
    version: 8,
  })
  console.log(
    "Event QR SQL pilot passed: installation, grants, retry, scan contention, custody, transfer, escalation, closure, reassignment and stale PIN.",
  )
} finally {
  await db.close()
}
