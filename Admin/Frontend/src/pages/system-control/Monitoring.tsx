import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, DatabaseBackup, Download, FileSpreadsheet, Mail, RefreshCw, Send, ShieldAlert, TriangleAlert, UserRoundCheck } from "lucide-react";
import { BTN, INPUT } from "../../components/ui/primitives";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { StatusPill, type Tone } from "../../components/ui/management";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { formatDateTime } from "../../utils/countdown";
import { sendTestEmail } from "../../utils/missionApi";
import { downloadAuditLog, fetchAdminHealth, fetchBackupStatus, fetchEmailHealth, type AdminHealth, type BackupStatus, type EmailHealth, type Severity, type StaffAccount } from "../../utils/opsApi";
import { tr } from "../../utils/preferences";
import { Card, ErrorNote } from "./parts";

const TONE: Record<Severity, Tone> = { ok: "mint", info: "slate", warn: "gold", fail: "rose" };
const LABEL: Record<Severity, string> = { ok: "Healthy", info: "Note", warn: "Needs attention", fail: "Act now" };
const ROLE: Record<StaffAccount["role"], string> = { super_admin: "Super admin", admin: "Admin", guard: "Guard" };

function Stat({ label, value, tone = "plain" }: { label: string; value: string | number; tone?: "plain" | "warn" | "fail" }) {
  return (
    <div className="rounded-2xl border border-line bg-frost-50 px-4 py-3">
      <dt className="text-[12.5px] font-medium text-ink-muted">{tr(label)}</dt>
      <dd className={`mt-0.5 font-[family-name:var(--font-heading)] text-[22px] font-semibold tabular-nums ${tone === "fail" ? "text-rose-700 dark:text-rose-300" : tone === "warn" ? "text-gold-800 dark:text-gold-300" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

/** Staff account health: who has no authenticator, who is locked or dormant. Read-only; fix accounts on the Users page. */
function StaffHealth() {
  const [data, setData] = useState<AdminHealth | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fetchAdminHealth()); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to check the staff accounts.")); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const flagged = data?.accounts.filter((account) => account.status === "warn" || account.status === "fail") ?? [];
  const shown = all ? data?.accounts ?? [] : flagged;

  return (
    <Card icon={<UserRoundCheck size={21} />} tone="navy" title={tr("Staff account health")}
      description={tr("Spots risky staff accounts: no authenticator app, repeated failed sign-ins, locked or long-unused access.")}
      aside={<button type="button" onClick={() => void load()} disabled={loading} className={`${BTN.ghost} !min-h-[38px]`}><RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" />{tr("Check again")}</button>}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <SkeletonBlock className="h-56 w-full rounded-2xl" />}
      {data && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Staff accounts" value={data.summary.total} />
            <Stat label="Need attention" value={data.summary.flagged} tone={data.summary.flagged ? "warn" : "plain"} />
            <Stat label="No authenticator" value={data.summary.mfa_available ? data.summary.without_mfa : "–"} tone={data.summary.without_mfa ? "fail" : "plain"} />
            <Stat label="Locked or dormant" value={data.summary.locked + data.summary.dormant} tone={data.summary.locked + data.summary.dormant ? "warn" : "plain"} />
          </dl>
          {!data.summary.mfa_available && <p className="rounded-xl bg-frost-50 px-3.5 py-2.5 text-[12.5px] text-ink-muted">{tr("Authenticator status could not be read, so it is not checked.")}</p>}

          {shown.length === 0 ? (
            <p className="flex items-center gap-2 rounded-2xl border border-tide-200 bg-tide-50 px-4 py-3 text-[14px] font-medium text-tide-700 dark:border-tide-500/30 dark:bg-tide-500/10 dark:text-tide-300"><CheckCircle2 size={17} aria-hidden="true" />{tr("Every staff account looks healthy.")}</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-[var(--surface)]">
              {shown.map((account) => (
                <li key={account.account_id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${account.status === "fail" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : account.status === "warn" ? "bg-gold-50 text-gold-800 dark:bg-gold-500/15 dark:text-gold-300" : "bg-frost-100 text-ink-muted"}`} aria-hidden="true">
                    {account.status === "fail" ? <ShieldAlert size={17} /> : <TriangleAlert size={17} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-ink">{account.name}<StatusPill tone="iris">{tr(ROLE[account.role])}</StatusPill></p>
                    <p className="truncate text-[12.5px] text-ink-muted">{account.email} · {account.last_login_at ? tr("Last sign-in {0}", { "0": formatDateTime(account.last_login_at) }) : tr("Never signed in")}</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {account.flags.map((flag) => <li key={flag.code}><StatusPill tone={TONE[flag.severity]}>{tr(flag.text)}</StatusPill></li>)}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setAll((value) => !value)} className="text-[13.5px] font-semibold text-iris-700 hover:underline dark:text-iris-300">{all ? tr("Show only accounts that need attention") : tr("Show all {0} staff accounts", { "0": data.summary.total })}</button>
        </div>
      )}
    </Card>
  );
}

/** Email service health: which provider, whether its key is accepted, this server's recent results, and a test message. */
function EmailService() {
  const [data, setData] = useState<EmailHealth | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fetchEmailHealth()); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to check the email service.")); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const test = async () => {
    setTesting(true);
    try {
      const result = await sendTestEmail();
      showInfoModal({ variant: result.ok ? "success" : "error", title: result.ok ? tr("Test email sent") : tr("Test email failed"), message: result.detail });
      await load();
    } catch { /* the API helper already showed the failure */ } finally { setTesting(false); }
  };

  return (
    <Card icon={<Mail size={21} />} tone={data?.status === "fail" ? "danger" : "mint"} title={tr("Email service")}
      description={tr("Codes, claim approvals and Smart Tag alerts all depend on this. It checks the key with the provider without sending anything.")}
      aside={<button type="button" onClick={() => void load()} disabled={loading} className={`${BTN.ghost} !min-h-[38px]`}><RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" />{tr("Check again")}</button>}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <SkeletonBlock className="h-44 w-full rounded-2xl" />}
      {data && (
        <div className="space-y-4">
          <div className={`flex items-start gap-3 rounded-2xl border p-4 ${data.status === "ok" ? "border-tide-200 bg-tide-50 dark:border-tide-500/30 dark:bg-tide-500/10" : data.status === "warn" ? "border-gold-300 bg-gold-50 dark:border-gold-500/30 dark:bg-gold-500/10" : "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10"}`} role="status">
            {data.status === "ok" ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-tide-700 dark:text-tide-300" aria-hidden="true" /> : <ShieldAlert size={20} className="mt-0.5 shrink-0 text-rose-700 dark:text-rose-300" aria-hidden="true" />}
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-ink">{data.status === "ok" ? tr("Email is working") : data.status === "warn" ? tr("Email needs a look") : tr("Email is not working")}</p>
              <p className="mt-0.5 text-[13.5px] leading-5 text-ink-soft">{data.detail}</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Provider" value={data.provider ?? "None"} />
            <Stat label="Sent since restart" value={data.stats.sent} />
            <Stat label="Failed since restart" value={data.stats.failed} tone={data.stats.failed ? "warn" : "plain"} />
            <Stat label="Provider key" value={data.live ? (data.live.ok ? "Accepted" : "Rejected") : "Not checked"} tone={data.live && !data.live.ok ? "fail" : "plain"} />
          </dl>
          <ul className="space-y-1 text-[13px] leading-5 text-ink-muted">
            {data.sender && <li>{tr("Sender: {0}", { "0": data.sender })}</li>}
            {data.live?.plan && <li>{tr("Plan: {0}", { "0": data.live.plan })}</li>}
            <li>{data.stats.last_ok_at ? tr("Last email accepted: {0}", { "0": formatDateTime(data.stats.last_ok_at) }) : tr("No email sent since the server last restarted.")}</li>
            {data.stats.last_fail_at && <li className="text-rose-700 dark:text-rose-300">{tr("Last failure: {0}, {1}", { "0": formatDateTime(data.stats.last_fail_at), "1": data.stats.last_error || tr("unknown error") })}</li>}
          </ul>
          <button type="button" onClick={() => void test()} disabled={testing || !data.configured} className={BTN.primary}><Send size={16} aria-hidden="true" />{testing ? tr("Sending…") : tr("Send a test email to me")}</button>
        </div>
      )}
    </Card>
  );
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "-";
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Database backups: when the nightly job last finished, whether it was encrypted, and how to set it up. Supabase Free has no downloadable backups of its own. */
function Backups() {
  const [data, setData] = useState<BackupStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fetchBackupStatus()); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to check the backups.")); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const last = data?.last;
  const title = !data ? "" : data.status === "ok" ? tr("Backups are running") : data.status === "warn" ? tr("Backups need a look") : tr("Backups have stopped");
  return (
    <Card icon={<DatabaseBackup size={21} />} tone={data?.status === "fail" ? "danger" : "navy"} title={tr("Database backups")}
      description={tr("Supabase Free keeps no backups you can download, so a nightly job copies the database to Google Drive. This shows whether it is still reporting in.")}
      aside={<button type="button" onClick={() => void load()} disabled={loading} className={`${BTN.ghost} !min-h-[38px]`}><RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" />{tr("Check again")}</button>}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <SkeletonBlock className="h-40 w-full rounded-2xl" />}
      {data && (
        <div className="space-y-4">
          <div className={`flex items-start gap-3 rounded-2xl border p-4 ${data.status === "ok" ? "border-tide-200 bg-tide-50 dark:border-tide-500/30 dark:bg-tide-500/10" : data.status === "warn" ? "border-gold-300 bg-gold-50 dark:border-gold-500/30 dark:bg-gold-500/10" : "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10"}`} role="status">
            {data.status === "ok" ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-tide-700 dark:text-tide-300" aria-hidden="true" /> : <ShieldAlert size={20} className="mt-0.5 shrink-0 text-rose-700 dark:text-rose-300" aria-hidden="true" />}
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-[13.5px] leading-5 text-ink-soft">{data.detail}</p>
            </div>
          </div>
          {last?.at && (
            <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat label="Last backup" value={formatDateTime(last.at)} />
              <Stat label="Size" value={formatBytes(last.bytes)} />
              <Stat label="Encrypted" value={last.encrypted ? "Yes" : "No"} tone={last.encrypted ? "plain" : "warn"} />
              <Stat label="Saved to" value={last.where ?? "-"} />
            </dl>
          )}
          <p className="text-[13px] leading-5 text-ink-muted">{tr("Setup and restore steps are in docs/BACKUP_GUIDE.md. Try a restore at least once, so you know it works before you need it.")}</p>
        </div>
      )}
    </Card>
  );
}

/** Audit log CSV export: every recorded action in a range of days, for reviews and investigations. The export is itself recorded. */
function AuditExport() {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const [start, setStart] = useState(() => new Date(Date.now() + 8 * 3_600_000 - 30 * 86_400_000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ rows: number; truncated: boolean } | null>(null);
  const [error, setError] = useState("");
  const valid = Boolean(start) && Boolean(end) && start <= end && end <= today;

  const preset = (days: number) => { setStart(new Date(Date.now() + 8 * 3_600_000 - days * 86_400_000).toISOString().slice(0, 10)); setEnd(today); };
  const run = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try { setResult(await downloadAuditLog(start, end)); } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to export the audit log.")); } finally { setBusy(false); }
  };

  return (
    <Card icon={<FileSpreadsheet size={21} />} tone="gold" title={tr("Audit log export")}
      description={tr("Download who did what, and when, as a spreadsheet (CSV). Times are in Manila time. Exporting is itself written to the log.")}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label={tr("Quick ranges")}>
          {[{ label: "Last 7 days", days: 7 }, { label: "Last 30 days", days: 30 }, { label: "Last 90 days", days: 90 }, { label: "This year", days: 365 }].map((option) => (
            <button key={option.label} type="button" onClick={() => preset(option.days)} className="rounded-full border border-line-strong bg-[var(--surface)] px-3.5 py-1.5 text-[13px] font-semibold text-ink-soft transition hover:border-iris-300">{tr(option.label)}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("From")}</span><input type="date" value={start} max={end || today} onChange={(event) => setStart(event.target.value)} className={INPUT} /></label>
          <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("To")}</span><input type="date" value={end} min={start} max={today} onChange={(event) => setEnd(event.target.value)} className={INPUT} /></label>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {result && <p className="flex items-center gap-2 text-[13.5px] font-medium text-tide-700 dark:text-tide-300" role="status"><CheckCircle2 size={16} aria-hidden="true" />{result.rows === 0 ? tr("No activity in this range, so the file only has the column names.") : tr("Downloaded {0} rows.", { "0": result.rows.toLocaleString() })}{result.truncated ? ` ${tr("The export stops at 50,000 rows: pick a shorter range for the rest.")}` : ""}</p>}
        <button type="button" onClick={() => void run()} disabled={!valid || busy} className={BTN.gold}><Download size={16} aria-hidden="true" />{busy ? tr("Preparing…") : tr("Download CSV")}</button>
      </div>
    </Card>
  );
}

export default function Monitoring() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[13px] text-ink-muted"><Activity size={15} aria-hidden="true" />{tr("Live checks. Nothing here changes any account or sends any email unless you press the button.")}</div>
      <StaffHealth />
      <Backups />
      <div className="grid gap-5 xl:grid-cols-2">
        <EmailService />
        <AuditExport />
      </div>
    </div>
  );
}
