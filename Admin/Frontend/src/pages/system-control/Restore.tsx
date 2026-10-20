import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, DatabaseZap, FileLock2, Lock, ShieldAlert, TriangleAlert, XCircle } from "lucide-react";
import { BTN, INPUT } from "../../components/ui/primitives";
import { formatDateTime } from "../../utils/countdown";
import { fetchRestoreStatus, previewRestore, startRestore, type RestoreJob, type RestorePreview } from "../../utils/opsApi";
import { tr } from "../../utils/preferences";
import { Card, ErrorNote } from "./parts";

function Check({ ok, warn = false, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : warn ? TriangleAlert : XCircle;
  const color = ok ? "text-tide-700 dark:text-tide-300" : warn ? "text-gold-800 dark:text-gold-300" : "text-rose-700 dark:text-rose-300";
  return <li className="flex items-start gap-2.5 text-[14px] leading-5 text-ink-soft"><Icon size={18} className={`mt-0.5 shrink-0 ${color}`} aria-hidden="true" /><span>{children}</span></li>;
}

function Progress({ job }: { job: RestoreJob }) {
  const done = job.done_tables?.length ?? 0;
  const total = job.total_tables ?? 0;
  const failed = Object.keys(job.failed ?? {});
  const tone = job.state === "running" ? "border-iris-300 bg-iris-50 dark:bg-iris-500/10" : job.state === "done" ? "border-tide-200 bg-tide-50 dark:border-tide-500/30 dark:bg-tide-500/10" : "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10";
  return (
    <div className={`rounded-2xl border p-4 ${tone}`} role="status" aria-live="polite">
      <p className="text-[15px] font-semibold text-ink">
        {job.state === "running" ? tr("Restoring now. Keep this page open.") : job.state === "done" ? tr("Restore finished") : job.state === "partial" ? tr("Restore finished with problems") : tr("Restore failed")}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-frost-100 dark:bg-white/10"><div className="h-full rounded-full bg-[linear-gradient(90deg,#2b4282,#6a84b8)] transition-[width]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      <p className="mt-2 text-[13.5px] text-ink-soft">
        {tr("{0} of {1} tables, {2} rows.", { "0": done, "1": total, "2": (job.rows ?? 0).toLocaleString() })}
        {job.state === "running" && job.current ? ` ${tr("Working on {0}.", { "0": job.current })}` : ""}
      </p>
      {job.error && <p className="mt-2 text-[13.5px] text-rose-800 dark:text-rose-200">{job.error}</p>}
      {failed.length > 0 && (
        <ul className="mt-2 space-y-1 text-[13px] text-rose-800 dark:text-rose-200">
          {failed.map((name) => <li key={name}><span className="font-semibold">{name}</span>: {job.failed?.[name]}</li>)}
          <li>{tr("Nothing was deleted. Fix the cause (often a missing parent record or migration) and run the restore again: it is safe to repeat.")}</li>
        </ul>
      )}
      {job.state !== "running" && <p className="mt-2 text-[13px] text-ink-muted">{tr("Maintenance mode is still on. Check the app, then turn it off in Controls and health.")}</p>}
    </div>
  );
}

/** Restore from a backup file: choose and read it, review the plan, confirm with phrases and an authenticator code, then watch it run. */
export default function Restore() {
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [plan, setPlan] = useState<RestorePreview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [acks, setAcks] = useState([false, false, false]);
  const [phrase, setPhrase] = useState("");
  const [sensitivePhrase, setSensitivePhrase] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<RestoreJob | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const poll = useCallback(async () => {
    try { const status = await fetchRestoreStatus(); setJob(status.job); return status.running; } catch { return false; }
  }, []);
  useEffect(() => {
    let live = true;
    const tick = async () => { const running = await poll(); if (live && running) timer.current = window.setTimeout(tick, 2000); };
    void tick();
    return () => { live = false; window.clearTimeout(timer.current); };
  }, [poll]);
  const watch = () => { window.clearTimeout(timer.current); const tick = async () => { if (await poll()) timer.current = window.setTimeout(tick, 2000); }; void tick(); };

  const running = job?.state === "running";
  const chosen = useMemo(() => plan?.tables.filter((t) => picked.has(t.name)) ?? [], [plan, picked]);
  const needsSensitive = chosen.some((t) => t.kind === "sensitive");
  const ready = Boolean(plan) && !running && chosen.length > 0 && plan!.maintenance_on && plan!.authenticator_enabled && acks.every(Boolean)
    && phrase.trim() === plan!.confirm_phrase && (!needsSensitive || sensitivePhrase.trim() === plan!.sensitive_phrase) && /^\d{6}$/.test(code);

  const reset = () => { setFile(null); setPassphrase(""); setPlan(null); setPicked(new Set()); setAcks([false, false, false]); setPhrase(""); setSensitivePhrase(""); setCode(""); setError(""); };

  const read = async () => {
    if (!file || !passphrase || busy) return;
    setBusy(true); setError("");
    try {
      const result = await previewRestore(file, passphrase);
      setPlan(result);
      setPicked(new Set(result.tables.filter((t) => t.restorable && t.kind === "normal").map((t) => t.name)));
      setAcks([false, false, false]); setPhrase(""); setSensitivePhrase(""); setCode("");
    } catch (failure) { setPlan(null); setError(failure instanceof Error ? failure.message : tr("Unable to read the backup.")); } finally { setBusy(false); }
  };

  const run = async () => {
    if (!ready || !file || !plan || busy) return;
    setBusy(true); setError("");
    try {
      const started = await startRestore({ file, passphrase, fileSha256: plan.file_sha256, tables: chosen.map((t) => t.name), confirmPhrase: phrase.trim(), sensitivePhrase: sensitivePhrase.trim(), authenticatorCode: code });
      setJob(started.job);
      reset();
      watch();
    } catch (failure) { setCode(""); setError(failure instanceof Error ? failure.message : tr("Unable to start the restore.")); } finally { setBusy(false); }
  };

  const toggle = (name: string) => setPicked((current) => { const next = new Set(current); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  const ACKS = [
    tr("I understand this puts the backup's version of each chosen row in place. Rows with the same ID are overwritten; nothing is deleted."),
    tr("I have a backup of today's data, or I accept that today's versions of those rows cannot be brought back."),
    tr("I understand the app stays in maintenance mode afterwards until I turn it off myself."),
  ];

  return (
    <Card icon={<DatabaseZap size={21} />} tone="danger" title={tr("Restore from a backup")}
      description={tr("Put data from an encrypted E-Balik backup file (.zip.enc) back into this database. Super administrators only, and it needs your Google Authenticator code.")}>
      <div className="space-y-5">
        {job && <Progress job={job} />}

        {!plan && (
          <div className="space-y-4">
            <ul className="space-y-1.5 rounded-2xl border border-line bg-frost-50 p-4 text-[13.5px] leading-5 text-ink-soft dark:bg-white/[0.04]">
              <li>{tr("Merges rows by ID. It never deletes anything, so newer records that are not in the backup stay.")}</li>
              <li>{tr("Photos are not restored here. Use the restore script on a computer for those.")}</li>
              <li>{tr("Sign-in secrets (authenticator, recovery codes, one-time codes) can never be restored from here.")}</li>
            </ul>
            <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Backup file")}</span>
              <input type="file" accept=".enc" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(""); }} className={`${INPUT} py-2`} />
            </label>
            <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Backup passphrase")}</span>
              <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="off" className={INPUT} />
            </label>
            {error && <ErrorNote>{error}</ErrorNote>}
            <button type="button" onClick={() => void read()} disabled={!file || !passphrase || busy} className={BTN.primary}><FileLock2 size={16} aria-hidden="true" />{busy ? tr("Reading…") : tr("Read and check the backup")}</button>
          </div>
        )}

        {plan && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px] text-ink-soft">
                {tr("Backup of project {0}, made {1}", { "0": plan.project ?? "?", "1": plan.created_at ? formatDateTime(plan.created_at) : "?" })}
                {plan.age_days != null ? ` (${tr("{0} days ago", { "0": plan.age_days })})` : ""}. {tr("It is intact and the passphrase is correct.")}
              </p>
              <button type="button" onClick={reset} className={`${BTN.ghost} !min-h-[38px]`}>{tr("Choose a different file")}</button>
            </div>

            <ul className="space-y-2 rounded-2xl border border-line p-4">
              <Check ok={plan.maintenance_on}>{plan.maintenance_on ? tr("Maintenance mode is on.") : tr("Turn on maintenance mode first (Controls and health), so nobody changes data during the restore.")}</Check>
              <Check ok={plan.authenticator_enabled}>{plan.authenticator_enabled ? tr("Google Authenticator is set up on your account.") : tr("Set up Google Authenticator in your Admin Profile first. A restore cannot start without it.")}</Check>
              <Check ok={plan.same_project} warn>{plan.same_project ? tr("This backup was made from this same project.") : tr("This backup is from a DIFFERENT project ({0}). Only continue if you are moving data on purpose.", { "0": plan.project ?? "?" })}</Check>
              <Check ok={plan.backup_status === "ok"} warn>{plan.backup_status === "ok" ? tr("A recent backup of the current data exists.") : tr("No recent healthy backup of the current data was reported. Make one first if you can.")}</Check>
            </ul>

            <div>
              <h3 className="mb-2 text-[15px] font-semibold text-ink">{tr("Choose what to restore")}</h3>
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {plan.tables.map((table) => (
                  <li key={table.name} className="flex items-start gap-3 px-4 py-3">
                    <input id={`rt-${table.name}`} type="checkbox" checked={picked.has(table.name)} disabled={!table.restorable} onChange={() => toggle(table.name)} className="mt-1 size-4 shrink-0 accent-navy-800" />
                    <label htmlFor={`rt-${table.name}`} className="min-w-0 flex-1 text-[14px]">
                      <span className="font-semibold text-ink">{table.name}</span>
                      <span className="ml-2 text-ink-muted">{tr("{0} rows in the backup, {1} now", { "0": table.rows.toLocaleString(), "1": table.current == null ? "-" : table.current.toLocaleString() })}</span>
                      {table.note && <span className={`mt-0.5 flex items-center gap-1.5 text-[13px] ${table.kind === "sensitive" ? "text-gold-800 dark:text-gold-300" : "text-ink-muted"}`}>{table.kind === "protected" ? <Lock size={13} aria-hidden="true" /> : <TriangleAlert size={13} aria-hidden="true" />}{table.note}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-500/30 dark:bg-rose-500/[0.07]">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink"><ShieldAlert size={18} className="text-rose-700 dark:text-rose-300" aria-hidden="true" />{tr("Confirm")}</h3>
              {ACKS.map((text, index) => (
                <label key={index} className="flex items-start gap-3 text-[14px] leading-5 text-ink-soft"><input type="checkbox" checked={acks[index]} onChange={() => setAcks((current) => current.map((v, i) => (i === index ? !v : v)))} className="mt-0.5 size-4 shrink-0 accent-navy-800" />{text}</label>
              ))}
              <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Type {0} to continue", { "0": plan.confirm_phrase })}</span>
                <input value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" spellCheck={false} className={INPUT} /></label>
              {needsSensitive && (
                <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("You chose accounts or settings. Also type {0}", { "0": plan.sensitive_phrase })}</span>
                  <input value={sensitivePhrase} onChange={(event) => setSensitivePhrase(event.target.value)} autoComplete="off" spellCheck={false} className={INPUT} /></label>
              )}
              <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Google Authenticator code")}</span>
                <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className={`${INPUT} max-w-[12rem] font-mono tracking-[0.3em]`} /></label>
              {error && <ErrorNote>{error}</ErrorNote>}
              <button type="button" onClick={() => void run()} disabled={!ready || busy} className={BTN.danger}><DatabaseZap size={16} aria-hidden="true" />{busy ? tr("Starting…") : tr("Restore {0} table(s) now", { "0": chosen.length })}</button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
