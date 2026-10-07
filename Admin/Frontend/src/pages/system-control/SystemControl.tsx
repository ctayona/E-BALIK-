import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, HeartPulse, Loader2, LockKeyhole, LogOut, RefreshCw, ShieldCheck, Trash2, Wrench, XCircle } from "lucide-react";
import { SegmentedFilter } from "../../components/ui/management";
import AdminGovernance from "./AdminGovernance";
import AnnouncementPanel from "./AnnouncementPanel";
import CommsHub from "./CommsHub";
import { AuditExport, EmailTester, StorageWidget } from "./DataTools";
import { Card } from "./parts";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { BTN, INPUT, PageHeader, RolePill } from "../../components/ui/primitives";
import {
  fetchCleanupPreview, fetchSystemOverview, forceLogoutAllUsers, runDatabaseCleanup, runHealthCheck, setMaintenanceMode,
  type CleanupPreview, type HealthReport, type HealthStatus, type SystemOverview,
} from "../../utils/systemApi";
import { formatDateTime } from "../../utils/countdown";
import { tr } from "../../utils/preferences";

const AGES = [30, 60, 90, 180, 365];
const HEALTH_LOOK: Record<HealthStatus, { icon: typeof CheckCircle2; text: string; chip: string; label: string }> = {
  ok: { icon: CheckCircle2, text: "text-[#1b7863] dark:text-[#6fd6bb]", chip: "bg-[#e6f7f1] text-[#14594a] ring-[#bfe8db] dark:bg-[#3fbf9f]/10 dark:text-[#9fe0ca] dark:ring-[#3fbf9f]/30", label: "Healthy" },
  warn: { icon: AlertTriangle, text: "text-gold-700 dark:text-gold-300", chip: "bg-gold-50 text-gold-800 ring-gold-200 dark:bg-gold-500/10 dark:text-gold-200 dark:ring-gold-500/30", label: "Needs attention" },
  fail: { icon: XCircle, text: "text-rose-600 dark:text-rose-300", chip: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-500/10 dark:text-[#fecdd3] dark:ring-rose-500/30", label: "Action required" },
};

function SetupNotice() {
  return (
    <section className="glass-panel flex items-start gap-4 border-gold-300/60 p-5" role="alert">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950"><Database size={20} aria-hidden="true" /></span>
      <div className="min-w-0">
        <h2 className="font-[family-name:var(--font-heading)] text-[17px] font-semibold text-ink">{tr("Maintenance mode and force logout need one database step")}</h2>
        <p className="mt-1 text-[14px] leading-6 text-ink-soft">{tr("Run Server/manual_migrations/20261006_system_control_verification.sql in the Supabase SQL Editor (after 20261005_auction_hall.sql), then reload this page. The health check and cleanup work without it.")}</p>
      </div>
    </section>
  );
}

type Pending = "maintenance" | "logout" | "cleanup" | null;
type Tab = "controls" | "announcement" | "comms" | "access" | "data";
const TABS: { value: Tab; label: string }[] = [
  { value: "controls", label: "Controls and health" },
  { value: "announcement", label: "Announcement" },
  { value: "comms", label: "Communications" },
  { value: "access", label: "Admin access" },
  { value: "data", label: "Data and email" },
];

export default function SystemControl() {
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [tab, setTab] = useState<Tab>("controls");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const [health, setHealth] = useState<HealthReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");

  const [days, setDays] = useState(30);
  const [includeUnread, setIncludeUnread] = useState(false);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const loadOverview = useCallback(async () => {
    try {
      const data = await fetchSystemOverview();
      setOverview(data);
      setMessage((current) => current || data.maintenance?.message || "");
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : tr("Unable to load system settings."));
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setPreviewError("");
    fetchCleanupPreview(days, includeUnread)
      .then((data) => { if (active) { setPreview(data); setPicked(data.targets.filter((row) => row.available && row.count > 0).map((row) => row.key)); } })
      .catch((error) => { if (active) setPreviewError(error instanceof Error ? error.message : tr("Unable to preview the cleanup.")); });
    return () => { active = false; };
  }, [days, includeUnread]);

  const scan = async () => {
    setScanning(true);
    setScanError("");
    try {
      setHealth(await runHealthCheck());
    } catch (error) {
      setScanError(error instanceof Error ? error.message : tr("Unable to run the health check."));
    } finally {
      setScanning(false);
    }
  };

  const maintenance = overview?.maintenance;
  const maintenanceOn = Boolean(maintenance?.enabled);
  const setupRequired = Boolean(overview?.setup_required);
  const selectedTotal = useMemo(() => (preview?.targets ?? []).filter((row) => picked.includes(row.key)).reduce((sum, row) => sum + row.count, 0), [preview, picked]);

  const confirm = async () => {
    if (!pending || busy) return;
    const action = pending;
    setBusy(true);
    try {
      if (action === "maintenance") await setMaintenanceMode(!maintenanceOn, message);
      else if (action === "logout") await forceLogoutAllUsers();
      else {
        await runDatabaseCleanup(days, includeUnread, picked);
        const fresh = await fetchCleanupPreview(days, includeUnread);
        setPreview(fresh);
        setPicked([]);
      }
      await loadOverview();
    } catch {
      // The API helper already showed the failure in the result modal.
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  if (!overview && !loadError) {
    return <div className="space-y-5 p-4 sm:p-6" aria-busy="true"><div><SkeletonBlock className="mb-2 h-8 w-56" /><SkeletonBlock className="h-4 w-80" /></div><div className="grid gap-4 lg:grid-cols-2"><SkeletonBlock className="h-64 rounded-2xl" /><SkeletonBlock className="h-64 rounded-2xl" /></div></div>;
  }

  const overall = health ? HEALTH_LOOK[health.status] : null;
  const lastCleanup = overview?.last_cleanup;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={tr("System control")}
        description={tr("Mission Control: lock the app, sign everyone out, post announcements, message users, govern admin access, export data and keep storage and email healthy. Only super admins can see this page.")}
        meta={<RolePill superAdmin />}
      />

      {loadError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{loadError}</p>}
      {setupRequired && <SetupNotice />}

      <SegmentedFilter label="System control sections" value={tab} onChange={setTab} options={TABS} />

      {tab === "announcement" && <AnnouncementPanel current={overview?.announcement ?? null} onSaved={() => void loadOverview()} />}
      {tab === "comms" && <CommsHub />}
      {tab === "access" && <AdminGovernance />}
      {tab === "data" && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-2"><AuditExport /><EmailTester /></div>
          <StorageWidget />
        </div>
      )}

      {tab === "controls" && <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          icon={<Wrench size={21} />}
          tone={maintenanceOn ? "danger" : "navy"}
          title={tr("Maintenance mode")}
          description={tr("Standard users cannot sign in or use the app while this is on. Admins and super admins can.")}
        >
          <div className={`flex items-center gap-4 rounded-2xl border p-4 transition-colors ${maintenanceOn ? "border-rose-300 bg-rose-50/70 dark:border-rose-500/40 dark:bg-rose-500/10" : "border-line bg-frost-50"}`}>
            <button
              type="button"
              role="switch"
              aria-checked={maintenanceOn}
              aria-label={tr("Maintenance mode")}
              disabled={setupRequired || !overview}
              onClick={() => setPending("maintenance")}
              className={`relative h-9 w-[68px] shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-iris-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${maintenanceOn ? "border-rose-500 bg-rose-500" : "border-line-strong bg-white dark:bg-white/10"}`}
            >
              <span className={`absolute left-1 top-1 flex size-7 items-center justify-center rounded-full bg-white text-navy-900 shadow-md transition-transform duration-200 ${maintenanceOn ? "translate-x-[30px]" : ""}`}>
                <LockKeyhole size={14} aria-hidden="true" />
              </span>
            </button>
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-heading)] text-[17px] font-semibold text-ink">{maintenanceOn ? tr("The app is locked") : tr("The app is open")}</p>
              <p className="text-[13px] text-ink-muted">{maintenanceOn && maintenance?.since ? tr("Since {0}", { "0": formatDateTime(maintenance.since) }) : tr("Everyone can use E-Balik.")}</p>
            </div>
          </div>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Message users will see")}</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              readOnly={maintenanceOn}
              rows={3}
              maxLength={280}
              placeholder={tr("We are upgrading E-Balik and will be back shortly.")}
              className={`${INPUT} resize-y py-3 leading-6 ${maintenanceOn ? "opacity-70" : ""}`}
            />
            <span className="mt-1 block text-[12.5px] text-ink-muted">{maintenanceOn ? tr("Turn maintenance off to edit the message.") : tr("Optional. Shown on the maintenance screen.")}</span>
          </label>
        </Card>

        <Card
          icon={<LogOut size={21} />}
          tone="danger"
          title={tr("Force logout")}
          description={tr("Sign every standard user out at once. Use it after a security problem or a major update.")}
        >
          <ul className="space-y-2 text-[14px] leading-6 text-ink-soft">
            <li className="flex gap-2.5"><ShieldCheck size={17} className="mt-1 shrink-0 text-[#2fae8e]" aria-hidden="true" />{tr("All active user sessions stop working on their next request.")}</li>
            <li className="flex gap-2.5"><ShieldCheck size={17} className="mt-1 shrink-0 text-[#2fae8e]" aria-hidden="true" />{tr("Admin and super admin sessions are not affected.")}</li>
            <li className="flex gap-2.5"><ShieldCheck size={17} className="mt-1 shrink-0 text-[#2fae8e]" aria-hidden="true" />{tr("Users can sign in again straight away, unless maintenance mode is on.")}</li>
          </ul>
          <p className="mt-4 text-[13px] text-ink-muted">{overview?.sessions_valid_after ? tr("Last forced logout: {0}", { "0": formatDateTime(overview.sessions_valid_after) }) : tr("No forced logout so far.")}</p>
          <div className="mt-auto pt-5">
            <button type="button" disabled={setupRequired || !overview} onClick={() => setPending("logout")} className={BTN.danger}><LogOut size={16} aria-hidden="true" />{tr("Sign out all users")}</button>
          </div>
        </Card>
      </div>

      <Card
        icon={<HeartPulse size={21} />}
        tone="mint"
        title={tr("Security and health check")}
        description={tr("Scans settings, the database, accounts and auctions, and tells you what needs attention.")}
        aside={<button type="button" onClick={() => void scan()} disabled={scanning} className={BTN.primary}>{scanning ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}{scanning ? tr("Scanning…") : health ? tr("Run again") : tr("Run check")}</button>}
      >
        {scanError && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{scanError}</p>}
        {!health && !scanning && !scanError && (
          <p className="rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center text-[14px] text-ink-muted">{tr("Run the check to see the system status. It only reads data and takes a few seconds.")}</p>
        )}
        {health && overall && (
          <div className="space-y-3">
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-4 py-3 ring-1 ${overall.chip}`} role="status">
              <overall.icon size={20} aria-hidden="true" />
              <span className="font-[family-name:var(--font-heading)] text-[17px] font-semibold">{tr(overall.label)}</span>
              <span className="text-[13px] opacity-80">{tr("Checked {0} in {1} ms", { "0": formatDateTime(health.checked_at), "1": health.duration_ms })}</span>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {health.checks.map((check) => {
                const look = HEALTH_LOOK[check.status];
                return (
                  <li key={check.id} className="flex items-start gap-3 px-4 py-3.5">
                    <look.icon size={19} className={`mt-0.5 shrink-0 ${look.text}`} aria-label={tr(look.label)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] font-semibold text-ink">{check.title}</p>
                      <p className="text-[13.5px] leading-5 text-ink-soft">{check.detail}</p>
                      {check.items && check.items.length > 0 && (
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] leading-5 text-ink-muted">
                          {check.items.map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <Card
        icon={<Trash2 size={21} />}
        tone="gold"
        title={tr("Database cleanup")}
        description={tr("Remove old notifications and expired verification codes to save space. Reports, claims, accounts and auctions are never touched.")}
      >
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tr("Delete data older than")}>
          <span className="mr-1 text-[14px] font-semibold text-ink-soft">{tr("Older than")}</span>
          {AGES.map((age) => (
            <button key={age} type="button" aria-pressed={days === age} onClick={() => setDays(age)} className={`min-h-[40px] rounded-xl border px-3.5 text-[13.5px] font-semibold transition ${days === age ? "border-gold-500 bg-gold-50 text-navy-900 dark:bg-gold-500/15 dark:text-gold-200" : "border-line-strong bg-[var(--surface)] text-ink-soft hover:border-iris-300"}`}>{tr("{0} days", { "0": age })}</button>
          ))}
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[14px] text-ink-soft">
          <input type="checkbox" checked={includeUnread} onChange={(event) => setIncludeUnread(event.target.checked)} className="size-4 accent-gold-600" />
          {tr("Also remove notifications that were never read")}
        </label>

        {previewError && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{previewError}</p>}
        {!preview && !previewError && <SkeletonBlock className="mt-4 h-28 w-full rounded-2xl" />}
        {preview && (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {preview.targets.map((row) => (
              <li key={row.key}>
                <label className={`flex items-center gap-3 px-4 py-3.5 ${row.available && row.count > 0 ? "cursor-pointer" : "opacity-60"}`}>
                  <input
                    type="checkbox"
                    disabled={!row.available || row.count === 0}
                    checked={picked.includes(row.key)}
                    onChange={(event) => setPicked((current) => event.target.checked ? [...current, row.key] : current.filter((key) => key !== row.key))}
                    className="size-4 accent-gold-600"
                  />
                  <span className="min-w-0 flex-1 text-[14.5px] font-medium text-ink">{tr(row.label)}{!row.available && <span className="ml-2 text-[12.5px] font-normal text-ink-muted">{tr("Table not found")}</span>}</span>
                  <span className="font-[family-name:var(--font-heading)] text-[17px] font-semibold tabular-nums text-ink">{row.count.toLocaleString()}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" disabled={!preview || selectedTotal === 0} onClick={() => setPending("cleanup")} className={BTN.danger}><Trash2 size={16} aria-hidden="true" />{selectedTotal ? tr("Delete {0} old records", { "0": selectedTotal.toLocaleString() }) : tr("Nothing to clean up")}</button>
          {lastCleanup && <p className="text-[13px] text-ink-muted">{tr("Last cleanup {0}: {1} records removed.", { "0": formatDateTime(lastCleanup.at), "1": Object.values(lastCleanup.deleted).reduce((sum, value) => sum + value, 0).toLocaleString() })}</p>}
        </div>
      </Card>

      </div>}

      {pending === "maintenance" && (
        <ConfirmActionDialog
          title={maintenanceOn ? "turn off maintenance mode" : "turn on maintenance mode"}
          description={maintenanceOn ? "Standard users can sign in and use E-Balik again." : "Standard users are locked out immediately and see the maintenance screen. Only admins and super admins can sign in."}
          confirmLabel={maintenanceOn ? "Turn off" : "Lock the app"}
          danger={!maintenanceOn}
          busy={busy}
          onCancel={() => { if (!busy) setPending(null); }}
          onConfirm={() => void confirm()}
        />
      )}
      {pending === "logout" && (
        <ConfirmActionDialog
          title="sign out all users"
          description="Every standard user is signed out and must sign in again. Unsaved work in open pages is lost. Admin sessions are not affected."
          confirmLabel="Sign out all users"
          danger
          busy={busy}
          onCancel={() => { if (!busy) setPending(null); }}
          onConfirm={() => void confirm()}
        />
      )}
      {pending === "cleanup" && (
        <ConfirmActionDialog
          title={tr("delete {0} old records", { "0": selectedTotal.toLocaleString() })}
          description={tr("This permanently deletes the selected records older than {0} days. It cannot be undone.", { "0": days })}
          confirmLabel="Delete records"
          danger
          busy={busy}
          onCancel={() => { if (!busy) setPending(null); }}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  );
}
