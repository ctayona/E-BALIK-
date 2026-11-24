// Independent PostgreSQL sessions against a fresh, loopback-only cluster. No external database URL.
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { randomUUID as uuid, randomBytes } from "node:crypto"
import { mkdtemp, writeFile, readFile } from "node:fs/promises"
import path from "node:path"
import net from "node:net"
const bin = process.argv[2]
if (!bin) throw Error("Supply local PostgreSQL bin directory.")
const scratch = await mkdtemp(
    path.resolve("node_modules/.cache/event-tag-pg-"),
  ),
  data = path.join(scratch, "data")
const exe = (name) =>
  path.join(bin, name + (process.platform === "win32" ? ".exe" : ""))
const port = await new Promise((resolve) => {
  const socket = net.createServer()
  socket.listen(0, "127.0.0.1", () => {
    const port = socket.address().port
    socket.close(() => resolve(port))
  })
})
const role = "test_" + randomBytes(6).toString("hex"),
  password = randomBytes(32).toString("hex")
const keyfile = path.join(scratch, "initial-password")
await writeFile(keyfile, password, { mode: 0o600 })
const env = { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: "3" }
const opts = {
  env,
  windowsHide: true,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
}
const args = [
  "-X",
  "-h",
  "127.0.0.1",
  "-p",
  String(port),
  "-U",
  role,
  "-d",
  "postgres",
  "-qAt",
  "-v",
  "ON_ERROR_STOP=1",
]
const query = (sql) =>
  execFileSync(exe("psql"), args, {
    ...opts,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim()
const child = (sql) => {
  const proc = spawn(exe("psql"), args, {
    ...opts,
    stdio: ["pipe", "pipe", "pipe"],
  })
  let out = "",
    err = ""
  proc.stdout.on("data", (s) => (out += s))
  proc.stderr.on("data", (s) => (err += s))
  proc.stdin.end(sql)
  return new Promise((resolve, reject) => {
    proc.on("error", reject)
    proc.on("exit", (code) => resolve({ code, out, err }))
  })
}
let started = false
try {
  execFileSync(
    exe("initdb"),
    [
      "-D",
      data,
      "-U",
      role,
      "--pwfile=" + keyfile,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
    ],
    opts,
  )
  await writeFile(keyfile, "")
  execFileSync(
    exe("pg_ctl"),
    [
      "-D",
      data,
      "-l",
      path.join(scratch, "server.log"),
      "-o",
      `-h 127.0.0.1 -p ${port}`,
      "-w",
      "start",
    ],
    { ...opts, stdio: "ignore", timeout: 90000 },
  )
  started = true
  // Only the dependencies used by these commands. Full migration chain is covered by the PGlite suite.
  query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text,public boolean);INSERT INTO storage.buckets VALUES('event-report-images',false);
 CREATE TABLE migration_log(name text primary key,note text);INSERT INTO migration_log VALUES('20261118_event_pilot_completion'),('20261123_campus_venues');
 CREATE TABLE user_profiles(account_id uuid primary key,is_active boolean,suspended_until timestamptz,access_level text,verification_status text);
 CREATE TABLE event_workspaces(event_id uuid primary key,name text,deleted_at timestamptz,status text,portal_enabled boolean,starts_at timestamptz,ends_at timestamptz,recovery_ends_at timestamptz);
 CREATE TABLE event_memberships(event_id uuid,account_id uuid,status text,role text,starts_at timestamptz,expires_at timestamptz);
 CREATE TABLE event_reports(report_id uuid primary key);CREATE TABLE event_closure_plans(event_id uuid,completed_at timestamptz);`)
  query(
    await readFile(
      new URL(
        "../Server/manual_migrations/20261124_event_smart_tags.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const [admin, user, other, ev, second, batch, tag] = Array.from(
    { length: 7 },
    () => uuid(),
  )
  query(`INSERT INTO user_profiles VALUES('${admin}',true,null,'super_admin','verified'),('${user}',true,null,'user','verified'),('${other}',true,null,'user','verified');
 INSERT INTO event_workspaces SELECT id,'Test event',null,'active',true,now()-interval '1 minute',now()+interval '1 hour',now()+interval '2 hours' FROM unnest(ARRAY['${ev}','${second}']::uuid[]) id;
 INSERT INTO event_tag_batches(batch_id,label) VALUES('${batch}','Fixture');INSERT INTO event_tags(code,batch_id) VALUES('${tag}','${batch}');`)
  const cmd = (
    actor,
    action,
    event,
    version,
    data,
    request = uuid(),
    reg = null,
  ) =>
    `SELECT event_tag_command('${actor}','${action}','${request}','${event}','${tag}',${
      reg ? "'" + reg + "'" : "null"
    },${version},'${JSON.stringify(data)}');`
  async function race(left, right, expected) {
    const first = child("BEGIN;" + left + "SELECT pg_sleep(1);COMMIT;")
    // Observe the first transaction holding its locks before issuing the competing command.
    for (let i = 0; i < 100; i++) {
      if (
        query(
          "SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep'",
        ) !== "0"
      )
        break
      await new Promise((r) => setTimeout(r, 15))
    }
    const [a, b] = await Promise.all([first, child(right)])
    assert.equal(a.code, 0, a.err)
    assert.equal(b.code, expected, b.err)
    return [a, b]
  }
  await race(
    cmd(admin, "assign", ev, 1, {}),
    cmd(admin, "assign", second, 1, {}),
    3,
  )
  const allocation = query("SELECT allocation_id FROM event_tag_allocations")
  query(`INSERT INTO event_tag_desks VALUES('${ev}',true,1)`)
  const registration = {
    allocation_id: allocation,
    item_name: "Blue bottle",
    description: "Fixture item",
    photo_path: "fixture",
  }
  await race(
    cmd(user, "register", ev, 2, registration),
    cmd(other, "register", ev, 2, registration),
    3,
  )
  const session = query("SELECT registration_id FROM event_tag_registrations"),
    request = uuid()
  const receive = cmd(
    admin,
    "receive",
    ev,
    1,
    {
      storage: "Shelf A",
      cipher: "cipher",
      hash: "hash",
      fingerprint: "opaque",
    },
    request,
    session,
  )
  const receipt = await race(receive, receive, 0)
  assert.ok(receipt[1].out.includes('"replay": true'))
  const release = cmd(
    admin,
    "collect",
    ev,
    2,
    { identity_checked: true, hash: "hash" },
    uuid(),
    session,
  )
  await race(
    release,
    cmd(
      admin,
      "collect",
      ev,
      2,
      { identity_checked: true, hash: "hash" },
      uuid(),
      session,
    ),
    3,
  )
  assert.equal(
    query("SELECT count(*) FROM event_tag_history WHERE action='collect'"),
    "1",
  )
  console.log(
    "Two-session PostgreSQL races passed: cross-event allocation, competing check-ins, receipt replay and duplicate pickup.",
  )
} finally {
  if (started)
    execFileSync(exe("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], {
      ...opts,
      stdio: "ignore",
      timeout: 30000,
    })
  await writeFile(keyfile, "")
}
