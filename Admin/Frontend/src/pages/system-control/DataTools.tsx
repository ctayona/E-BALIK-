import { useCallback, useEffect, useState } from "react";
import { DatabaseBackup, FileArchive, FileJson, HardDrive, ImageOff, Loader2, Mail, MailCheck, MailX, RefreshCw, ScanSearch, Trash2 } from "lucide-react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { BTN } from "../../components/ui/primitives";
import {
  SetupRequiredError, cleanOrphans, downloadExport, fetchStorage, formatBytes, scanOrphans, sendTestEmail,
  type EmailTestResult, type OrphanScan, type StorageOverview,
} from "../../utils/missionApi";
import { tr } from "../../utils/preferences";
import { Card, ErrorNote, MigrationNotice } from "./parts";

const IMAGE_BUCKETS = ["found-item-images", "missing-item-images", "smart-tag-images", "claim-proof-images"];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-frost-50 px-4 py-3.5">
      <p className="text-[12.5px] font-medium text-ink-muted">{label}</p>
      <p className="mt-0.5 font-[family-name:var(--font-heading)] text-[24px] font-semibold leading-tight tabular-nums text-ink">{value}</p>
      {hint && <p className="text-[12px] text-ink-muted">{hint}</p>}
    </div>
  );
}

export function AuditExport() {
  const [busy, setBusy] = useState<"json" | "csv" | null>(null);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  const run = async (format: "json" | "csv") => {
    setBusy(format);
    setError("");
    setDone("");
    try {
      setDone(await downloadExport(format));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to create the export."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card icon={<DatabaseBackup size={21} />} tone="gold" title={tr("One-click audit export")} description={tr("A master backup of users, claims, found items and lost reports with their totals, for official University reporting.")}>
      <ul className="mb-4 space-y-1.5 text-[13.5px] leading-6 text-ink-soft">
        <li>{tr("Includes names, emails, campus IDs, statuses and dates.")}</li>
        <li>{tr("Never includes passwords, ID documents, proof images or claim descriptions.")}</li>
        <li>{tr("CSV opens in Excel as a zip of one sheet per section. JSON keeps everything in one file.")}</li>
      </ul>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy !== null} onClick={() => void run("csv")} className={BTN.gold}>{busy === "csv" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileArchive size={16} aria-hidden="true" />}{busy === "csv" ? tr("Preparing…") : tr("Download CSV (zip)")}</button>
        <button type="button" disabled={busy !== null} onClick={() => void run("json")} className={BTN.ghost}>{busy === "json" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileJson size={16} aria-hidden="true" />}{busy === "json" ? tr("Preparing…") : tr("Download JSON")}</button>
      </div>
      {done && <p className="mt-3 text-[13.5px] text-[#1b7863] dark:text-[#6fd6bb]" role="status">{tr("Saved {0}", { "0": done })}</p>}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Card>
  );
}

export function StorageWidget() {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [setup, setSetup] = useState("");
  const [error, setError] = useState("");
  const [scan, setScan] = useState<OrphanScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setOverview(await fetchStorage());
      setSetup("");
      setError("");
    } catch (failure) {
      if (failure instanceof SetupRequiredError) setSetup(failure.message);
      else setError(failure instanceof Error ? failure.message : tr("Unable to load the storage statistics."));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError("");
    setNote("");
    try {
      setScan(await scanOrphans());
    } catch (failure) {
      if (failure instanceof SetupRequiredError) setSetup(failure.message);
      else setError(failure instanceof Error ? failure.message : tr("Unable to scan for orphaned images."));
    } finally {
      setScanning(false);
    }
  };

  const clean = async () => {
    setBusy(true);
    try {
      const result = await cleanOrphans();
      setNote(result.message);
      setScan(null);
      await load();
    } catch {
      // The API helper already showed the reason.
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const images = (overview?.buckets ?? []).filter((bucket) => IMAGE_BUCKETS.includes(bucket.bucket));
  const largest = Math.max(1, ...images.map((bucket) => bucket.bytes));

  return (
    <Card
      icon={<HardDrive size={21} />}
      tone="mint"
      title={tr("Storage and cleanup")}
      description={tr("How many images Supabase holds, and a safe way to delete pictures whose report, tag or claim no longer exists.")}
      aside={<button type="button" onClick={() => void load()} className={BTN.ghost} aria-label={tr("Refresh storage")}><RefreshCw size={15} aria-hidden="true" /></button>}
    >
      {setup && <MigrationNotice message={setup} />}
      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      {!setup && !overview && !error && <SkeletonBlock className="h-40 w-full rounded-2xl" />}
      {overview && !setup && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={tr("Images stored")} value={overview.image_objects.toLocaleString()} hint={tr("in the four image buckets")} />
            <Stat label={tr("Image space")} value={formatBytes(overview.image_bytes)} />
            <Stat label={tr("All files")} value={overview.total_objects.toLocaleString()} hint={tr("including ID documents")} />
            <Stat label={tr("All space")} value={formatBytes(overview.total_bytes)} />
          </div>
          <ul className="space-y-2" aria-label={tr("Images per bucket")}>
            {images.map((bucket) => (
              <li key={bucket.bucket} className="grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 text-[13px] sm:grid-cols-[190px_1fr_auto]">
                <span className="truncate font-medium text-ink-soft">{bucket.bucket}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-frost-100"><span className="block h-full rounded-full bg-[linear-gradient(90deg,#3fbf9f,#d1a153)]" style={{ width: `${Math.max(2, (bucket.bytes / largest) * 100)}%` }} /></span>
                <span className="whitespace-nowrap tabular-nums text-ink-muted">{bucket.objects.toLocaleString()} · {formatBytes(bucket.bytes)}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-2xl border border-line bg-frost-50 p-4">
            <p className="flex items-center gap-2 text-[14.5px] font-semibold text-ink"><ImageOff size={17} className="text-gold-700 dark:text-gold-300" aria-hidden="true" />{tr("Orphaned images")}</p>
            <p className="mt-1 text-[13.5px] leading-6 text-ink-soft">{tr("A picture is an orphan when no report, auction, Smart Tag or claim uses it and it is more than a day old. The scan only reads; nothing is deleted until you confirm. If any table cannot be read, the cleanup stops.")}</p>
            {scan && (
              <div className="mt-3 rounded-xl border border-line bg-[var(--surface)] px-4 py-3" role="status">
                {scan.total === 0
                  ? <p className="text-[14px] font-medium text-[#1b7863] dark:text-[#6fd6bb]">{tr("No orphaned images. Storage is tidy.")}</p>
                  : <>
                    <p className="text-[14.5px] font-semibold text-ink">{tr("{0} orphaned image(s), {1}", { "0": scan.total.toLocaleString(), "1": formatBytes(scan.bytes) })}</p>
                    <ul className="mt-1.5 space-y-0.5 text-[13px] text-ink-muted">{scan.buckets.filter((b) => b.count > 0).map((b) => <li key={b.bucket}>{b.bucket}: {b.count.toLocaleString()} ({formatBytes(b.bytes)})</li>)}</ul>
                  </>}
              </div>
            )}
            {note && <p className="mt-3 text-[13.5px] text-[#1b7863] dark:text-[#6fd6bb]" role="status">{note}</p>}
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void runScan()} disabled={scanning || busy} className={BTN.ghost}>{scanning ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ScanSearch size={16} aria-hidden="true" />}{scanning ? tr("Scanning…") : scan ? tr("Scan again") : tr("Scan for orphans")}</button>
              <button type="button" onClick={() => setConfirming(true)} disabled={!scan || scan.total === 0 || busy} className={BTN.danger}><Trash2 size={16} aria-hidden="true" />{scan && scan.total > 0 ? tr("Clean {0} orphaned images", { "0": scan.total.toLocaleString() }) : tr("Clean orphaned images")}</button>
            </div>
          </div>
        </div>
      )}
      {confirming && scan && (
        <ConfirmActionDialog
          title={tr("delete {0} orphaned images", { "0": scan.total.toLocaleString() })}
          description={tr("This permanently deletes {0} of pictures that nothing uses any more. Images in use are never touched. It cannot be undone.", { "0": formatBytes(scan.bytes) })}
          confirmLabel="Delete orphaned images"
          danger
          busy={busy}
          onCancel={() => { if (!busy) setConfirming(false); }}
          onConfirm={() => void clean()}
        />
      )}
    </Card>
  );
}

export function EmailTester() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EmailTestResult | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await sendTestEmail());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to run the email test."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card icon={<Mail size={21} />} tone="navy" title={tr("Email delivery test")} description={tr("Sends a test message to your own address to prove the email service (SendGrid) is working. Use it before an announcement.")}>
      <button type="button" onClick={() => void run()} disabled={busy} className={`${BTN.primary} self-start`}>{busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Mail size={16} aria-hidden="true" />}{busy ? tr("Sending…") : tr("Send me a test email")}</button>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {result && (
        <div className={`mt-4 flex items-start gap-3 rounded-2xl border p-4 ${result.ok ? "border-[#bfe8db] bg-[#e6f7f1] text-[#14594a] dark:border-[#3fbf9f]/30 dark:bg-[#3fbf9f]/10 dark:text-[#9fe0ca]" : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"}`} role="status">
          {result.ok ? <MailCheck size={20} className="mt-0.5 shrink-0" aria-hidden="true" /> : <MailX size={20} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <div className="min-w-0 text-[14px] leading-6">
            <p className="font-semibold">{result.ok ? tr("The email service is healthy") : tr("The email did not go out")}</p>
            <p>{result.detail}</p>
            <p className="mt-1 text-[12.5px] opacity-80">{tr("To {0} via {1}", { "0": result.to, "1": result.provider })}{result.status_code ? ` · ${tr("status")} ${result.status_code}` : ""}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
