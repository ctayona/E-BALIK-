import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Banknote, Expand, Trash2, X as CloseIcon, Ban, CalendarClock, Check, ClipboardCheck, Copy, Database, Download, Eye, Hourglass, Layers, Nfc, Package, Pencil, PhilippinePeso, QrCode, Radio, RefreshCw, RotateCw, ShieldCheck, ShieldOff, Tags, TriangleAlert } from "lucide-react";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, INPUT, PageHeader, RolePill } from "../../components/ui/primitives";
import { DataTable, DetailGrid, ExportButton, IconAction, RowActions, SearchField, SegmentedFilter, StatusPill, TableFooter, Toolbar, usePagination, type Tone } from "../../components/ui/management";
import {
  SmartTagSetupError, deactivateSmartTag, deactivateTagBatch, fetchSmartTagPhoto, fetchSmartTagQr, fetchSmartTags, fetchTagBatches, generateSmartTagBatch, reactivateSmartTag, reactivateTagBatch, renewSmartTag, setTagBatchPrice, deleteSmartTag, deleteTagBatch, isDeletableTag, type SmartTagRevenue,
  type AdminSmartTag, type GeneratedBatch, type SmartTagList, type TagBatch, type TagFilter, type TagType, type TagTypeOption,
} from "../../utils/smartTagsApi";
import AdminTagEditModal from "./AdminTagEditModal";
import VerificationModal from "./VerificationModal";
import { downloadCsv } from "../../utils/csv";
import { formatDateTime } from "../../utils/countdown";
import { canDelete } from "../../utils/permissions";
import { tr } from "../../utils/preferences";

const PESO = (value: number) => `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SPACED = (code: string) => code.replace(/(.{4})/g, "$1 ").trim();

const VALIDITY_PRESETS = [
  { value: "12", label: "1 academic year (12 months)" },
  { value: "6", label: "6 months" },
  { value: "24", label: "2 years (24 months)" },
  { value: "0", label: "Never expires" },
  { value: "custom", label: "Custom number of months" },
];
const TYPE_ICON: Record<TagType, ReactNode> = { qr: <QrCode size={17} aria-hidden="true" />, rfid: <Radio size={17} aria-hidden="true" />, nfc: <Nfc size={17} aria-hidden="true" /> };
const TYPE_LABEL: Record<TagType, string> = { qr: "QR Code", rfid: "RFID", nfc: "NFC" };

const monthsLabel = (months: number | null) => (!months ? tr("Never expires") : months === 12 ? tr("1 year") : tr("{0} months", { "0": months }));
const daysText = (days: number) => (days < 0 ? tr("Expired") : days === 0 ? tr("Expires today") : days === 1 ? tr("1 day left") : tr("{0} days left", { "0": days }));
const daysTone = (days: number): Tone => (days <= 7 ? "rose" : days <= 30 ? "gold" : "mint");

function tagState(tag: AdminSmartTag): { label: string; tone: Tone } {
  if (tag.is_disabled) return { label: "Deactivated", tone: "rose" };
  if (tag.status === "blank") return { label: "Blank", tone: "slate" };
  if (tag.status === "pending_verification") return { label: "Pending approval", tone: "gold" };
  if (tag.status === "expired") return { label: "Expired", tone: "rose" };
  if (tag.status === "lost") return { label: "Lost", tone: "gold" };
  return { label: "Active", tone: "mint" };
}

/** When a tag stops working: a countdown for registered tags, the planned period for blank ones. */
function ValidityCell({ tag }: { tag: AdminSmartTag }) {
  if (tag.status === "pending_verification" && !tag.valid_until) return <span className="text-[13px] text-ink-muted">{tr("Starts when approved")}</span>;
  if (tag.status === "blank") return <span className="text-[13px] text-ink-muted">{tag.validity_months ? tr("{0} after registering", { "0": monthsLabel(tag.validity_months) }) : tr("No expiry")}</span>;
  if (!tag.valid_until) return <span className="text-[13px] text-ink-muted">{tr("No expiry")}</span>;
  return (
    <div className="space-y-1">
      <div className="whitespace-nowrap text-[13px] text-ink-muted">{formatDateTime(tag.valid_until)}</div>
      {tag.status === "expired" ? <StatusPill tone="rose">{tr("Expired")}</StatusPill> : tag.days_left !== null && <StatusPill tone={daysTone(tag.days_left)}>{daysText(tag.days_left)}</StatusPill>}
    </div>
  );
}

/** Batches with the soonest-expiring registered tags first, so renewals and reprints are never a surprise. */
function BatchPanel({ batches, superAdmin, onDeactivate, onReactivate, onPrice, onDelete }: { batches: TagBatch[]; superAdmin: boolean; onDeactivate: (batch: TagBatch) => void; onReactivate: (batch: TagBatch) => void; onPrice: (batch: TagBatch) => void; onDelete: (batch: TagBatch) => void }) {
  const [all, setAll] = useState(false);
  if (!batches.length) return null;
  const shown = all ? batches : batches.slice(0, 4);
  return (
    <section className="glass-panel overflow-hidden" aria-label={tr("Batches by expiry")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5 sm:px-6">
        <div>
          <h2 className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink"><CalendarClock size={17} className="text-gold-600" aria-hidden="true" />{tr("Batches by expiry")}</h2>
          <p className="text-[12.5px] text-ink-muted">{tr("The batches whose registered tags expire soonest come first.")}</p>
        </div>
        {batches.length > 4 && <button type="button" onClick={() => setAll((v) => !v)} className="text-[13px] font-semibold text-iris-700 hover:underline dark:text-iris-300">{all ? tr("Show fewer") : tr("Show all {0} batches", { "0": batches.length })}</button>}
      </div>
      <ul className="divide-y divide-line">
        {shown.map((batch) => {
          const registered = batch.active + batch.lost + batch.expired;
          const expiry = batch.days_to_expiry;
          return (
            <li key={batch.batch_id ?? batch.label} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 sm:px-6">
              <div className="min-w-[180px] flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{batch.label}</span><StatusPill tone="slate">{TYPE_LABEL[batch.tag_type]}</StatusPill>{batch.all_disabled && <StatusPill tone="rose">{tr("Deactivated")}</StatusPill>}</div>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">{tr("{0} tags, {1} registered, {2} blank", { "0": batch.total, "1": registered, "2": batch.blank })} · {monthsLabel(batch.validity_months)}</p>
                {batch.price !== null && batch.price !== undefined && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                    <span className="inline-flex items-center gap-1 font-semibold text-gold-800 dark:text-gold-300"><PhilippinePeso size={13} aria-hidden="true" />{batch.price > 0 ? tr("{0} each", { "0": PESO(batch.price) }) : tr("Free")}</span>
                    {batch.sold > 0 && <span className="text-tide-700 dark:text-tide-300">{tr("{0} paid · {1} earned", { "0": batch.sold, "1": PESO(batch.revenue) })}</span>}
                  </p>
                )}
              </div>
              <div className="min-w-[150px]">
                {expiry !== null ? <StatusPill tone={daysTone(expiry)}>{expiry < 0 ? tr("Expired") : tr("Next expiry: {0}", { "0": daysText(expiry) })}</StatusPill>
                  : batch.expired > 0 ? <StatusPill tone="rose">{tr("{0} expired", { "0": batch.expired })}</StatusPill> : <span className="text-[13px] text-ink-muted">{tr("No expiry date yet")}</span>}
                {batch.expiring_soon > 0 && <p className="mt-1 text-[12.5px] text-gold-700 dark:text-gold-300">{tr("{0} expire within 30 days", { "0": batch.expiring_soon })}</p>}
                {batch.expired > 0 && expiry !== null && <p className="mt-1 text-[12.5px] text-rose-700 dark:text-rose-300">{tr("{0} already expired", { "0": batch.expired })}</p>}
              </div>
              {superAdmin && batch.batch_id && (
                <div className="flex flex-wrap gap-2">
                  {batch.price !== null && batch.price !== undefined && batch.blank > 0 && <button type="button" onClick={() => onPrice(batch)} className={`${BTN.ghost} !min-h-[38px]`}><PhilippinePeso size={15} aria-hidden="true" />{tr("Set price")}</button>}
                  {batch.disabled < batch.total && <button type="button" onClick={() => onDeactivate(batch)} className={`${BTN.ghost} !min-h-[38px] text-rose-700 dark:text-rose-300`}><Ban size={15} aria-hidden="true" />{tr("Deactivate batch")}</button>}
                  {batch.disabled > 0 && <button type="button" onClick={() => onReactivate(batch)} className={`${BTN.ghost} !min-h-[38px]`}><ShieldCheck size={15} aria-hidden="true" />{tr("Reactivate batch")}</button>}
                  {batch.blank + batch.disabled > 0 && <button type="button" onClick={() => onDelete(batch)} className={`${BTN.ghost} !min-h-[38px] text-rose-700 dark:text-rose-300`}><Trash2 size={15} aria-hidden="true" />{tr("Delete unused")}</button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Super admins: change what an unsold tag in this batch costs. Tags already registered keep the price that was paid. */
function BatchPriceModal({ batch, onClose, onSaved }: { batch: TagBatch; onClose: () => void; onSaved: () => void }) {
  const [price, setPrice] = useState(String(batch.price ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = Number(price || "0");
  const valid = /^\d{0,6}(\.\d{0,2})?$/.test(price) && value >= 0 && value <= 100000;
  const save = async () => {
    if (!valid || busy || !batch.batch_id) return;
    setBusy(true);
    setError("");
    try {
      await setTagBatchPrice(batch.batch_id, value);
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to change the price."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminModal
      title={tr("Price for {0}", { "0": batch.label })}
      description={tr("Applies to the {0} unsold tags in this batch. Tags already registered keep the price that was paid.", { "0": batch.blank })}
      icon={<PhilippinePeso size={19} />}
      tone="gold"
      size="sm"
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
          <button type="button" onClick={() => void save()} disabled={!valid || busy} className={BTN.primary}>{busy ? tr("Saving…") : tr("Save price")}</button>
        </>
      )}
    >
      <label className="block">
        <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Price per tag")}</span>
        <span className="relative block">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-ink-muted" aria-hidden="true">₱</span>
          <input value={price} onChange={(event) => setPrice(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className={`${INPUT} pl-8`} data-autofocus />
        </span>
        <span className={`mt-1 block text-[12.5px] ${valid ? "text-ink-muted" : "text-rose-600"}`}>{valid ? tr("Stock value after the change: {0}.", { "0": PESO(value * batch.blank) }) : tr("Enter a price from 0 to 100,000 pesos (up to 2 decimals).")}</span>
      </label>
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800">{error}</p>}
    </AdminModal>
  );
}

function SetupNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="glass-panel mx-auto max-w-[680px] p-6 sm:p-8" role="alert">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950"><Database size={22} aria-hidden="true" /></span>
      <h2 className="mt-4 font-[family-name:var(--font-heading)] text-[22px] font-semibold text-ink">{tr("Smart Tags need one database step")}</h2>
      <p className="mt-2 text-[14.5px] leading-6 text-ink-soft">{tr("The Smart Tags table has not been created in Supabase yet.")}</p>
      <ol className="mt-4 space-y-2 text-[14px] leading-6 text-ink-soft">
        <li>{tr("Open the Supabase dashboard and choose SQL Editor.")}</li>
        <li>{tr("Paste and run the contents of Server/manual_migrations/20261008_smart_tags.sql.")}</li>
        <li>{tr("Come back here and press Check again.")}</li>
      </ol>
      <p className="mt-4 rounded-xl bg-frost-50 px-4 py-3 text-[13px] text-ink-muted">{message}</p>
      <button type="button" onClick={onRetry} className={`${BTN.primary} mt-5`}><RefreshCw size={16} aria-hidden="true" />{tr("Check again")}</button>
    </section>
  );
}

/** Generate a batch of blank tags, then offer the printable list (codes and the URL each QR must point to). */
function BatchModal({ maxBatch, tagTypes, onClose, onCreated }: { maxBatch: number; tagTypes: TagTypeOption[]; onClose: () => void; onCreated: () => void }) {
  const [count, setCount] = useState("50");
  const [label, setLabel] = useState("");
  const [tagType, setTagType] = useState<TagType>("qr");
  const [preset, setPreset] = useState("12");
  const [custom, setCustom] = useState("18");
  const [price, setPrice] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GeneratedBatch | null>(null);
  const amount = Number(count);
  const countValid = Number.isInteger(amount) && amount >= 1 && amount <= maxBatch;
  const months = preset === "custom" ? Number(custom) : Number(preset);
  const monthsValid = preset === "0" || (Number.isInteger(months) && months >= 1 && months <= 120);
  const unitPrice = Number(price || "0");
  const priceValid = /^\d{0,6}(\.\d{0,2})?$/.test(price) && unitPrice >= 0 && unitPrice <= 100000;
  const valid = countValid && monthsValid && priceValid;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(await generateSmartTagBatch(amount, label.trim(), tagType, preset === "0" ? null : months, unitPrice));
      onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to generate the batch."));
    } finally {
      setBusy(false);
    }
  };

  const exportBatch = () => result && downloadCsv(`smart-tags-${result.batch_label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, ["Tag code", "Type", "Value to write on the tag", "Valid for", "Batch"],
    result.tag_ids.map((id, index) => [id, TYPE_LABEL[result.tag_type], result.values?.[index] ?? `${result.tag_url_base}/tag/${id}`, result.validity_months ? `${result.validity_months} months after registering` : "Never expires", result.batch_label]));

  return (
    <AdminModal
      title={result ? tr("{0} tags are ready", { "0": result.count }) : tr("Generate a batch")}
      description={result ? tr("They are saved as blank. Export the list to print or encode them.") : tr("Creates new blank tags with secure, unguessable codes.")}
      icon={result ? <Check size={19} /> : <Layers size={19} />}
      tone={result ? "mint" : "navy"}
      size="sm"
      busy={busy}
      onClose={onClose}
      footer={result ? (
        <>
          <button type="button" onClick={onClose} className={BTN.ghost}>{tr("Done")}</button>
          <button type="button" onClick={exportBatch} className={BTN.primary}><Download size={16} aria-hidden="true" />{tr("Download codes and URLs")}</button>
        </>
      ) : (
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
          <button type="button" onClick={() => void submit()} disabled={!valid || busy} className={BTN.primary}>{busy ? tr("Generating…") : tr("Generate {0} tags", { "0": valid ? amount : "" })}</button>
        </>
      )}
    >
      {result ? (
        <div className="space-y-3">
          <p className="rounded-2xl border border-line bg-frost-50 px-4 py-3 text-[14px] leading-6 text-ink-soft">{tr("Batch: {0}", { "0": result.batch_label })} · {TYPE_LABEL[result.tag_type]} · {monthsLabel(result.validity_months)} · {result.price ? tr("{0} each", { "0": PESO(result.price) }) : tr("Free")}</p>
          <ul className="max-h-48 overflow-y-auto rounded-2xl border border-line px-4 py-2 font-mono text-[13px] leading-7 text-ink-soft">
            {result.tag_ids.slice(0, 8).map((id) => <li key={id}>{SPACED(id)}</li>)}
            {result.tag_ids.length > 8 && <li className="text-ink-muted">{tr("…and {0} more in the download", { "0": result.tag_ids.length - 8 })}</li>}
          </ul>
          {result.url_check && !result.url_check.ok && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] leading-5 text-rose-900">{tr("Do not print yet: these QR codes would open {0}. {1}", { "0": result.url_check.url, "1": result.url_check.reason })}</p>}
          <p className="text-[13px] leading-5 text-ink-muted">{result.tag_type === "rfid" ? tr("Write each code onto its RFID chip exactly as it appears in the download.") : tr("Each QR code must open {0}/tag/<code>. Anyone with a sticker can scan it, so keep unsold stickers safe.", { "0": result.tag_url_base })}</p>
          {result.validity_months && <p className="text-[13px] leading-5 text-ink-muted">{tr("The validity period starts when the owner registers the tag, not when it is printed.")}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("How many tags?")}</span>
            <input value={count} onChange={(event) => setCount(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={INPUT} data-autofocus />
            <span className={`mt-1 block text-[12.5px] ${countValid ? "text-ink-muted" : "text-rose-600"}`}>{tr("Between 1 and {0} at a time.", { "0": maxBatch })}</span>
          </label>
          <fieldset>
            <legend className="mb-1.5 text-[14px] font-semibold text-ink-soft">{tr("Tag type")}</legend>
            <div className="grid grid-cols-3 gap-2">
              {tagTypes.map((option) => (
                <button key={option.value} type="button" disabled={!option.enabled} aria-pressed={tagType === option.value} onClick={() => setTagType(option.value)}
                  className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border px-2 text-[13.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${tagType === option.value ? "border-navy-700 bg-navy-50 text-navy-900 shadow-[0_0_0_3px_rgba(110,142,240,0.2)] dark:border-gold-400 dark:bg-white/10 dark:text-gold-200" : "border-line-strong text-ink-soft hover:border-iris-300"}`}>
                  {TYPE_ICON[option.value]}{option.label}
                  {!option.enabled && <span className="text-[11.5px] font-normal text-ink-muted">{tr("Not available yet")}</span>}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="block">
              <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Valid for")}</span>
              <select value={preset} onChange={(event) => setPreset(event.target.value)} className={INPUT}>
                {VALIDITY_PRESETS.map((option) => <option key={option.value} value={option.value}>{tr(option.label)}</option>)}
              </select>
            </label>
            {preset === "custom" && <input value={custom} onChange={(event) => setCustom(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" aria-label={tr("Months")} className={`${INPUT} mt-2`} />}
            <span className={`mt-1 block text-[12.5px] ${monthsValid ? "text-ink-muted" : "text-rose-600"}`}>{monthsValid ? (preset === "0" ? tr("These tags never expire.") : tr("Counted from the day the owner registers the tag.")) : tr("Enter between 1 and 120 months.")}</span>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Price per tag")}</span>
            <span className="relative block">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-ink-muted" aria-hidden="true">₱</span>
              <input value={price} onChange={(event) => setPrice(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-describedby="batch-price-hint" className={`${INPUT} pl-8`} />
            </span>
            <span id="batch-price-hint" className={`mt-1 block text-[12.5px] ${priceValid ? "text-ink-muted" : "text-rose-600"}`}>
              {!priceValid ? tr("Enter a price from 0 to 100,000 pesos (up to 2 decimals).")
                : unitPrice > 0 ? tr("Owners pay {0} at the office when staff approve the tag. Stock value: {1}.", { "0": PESO(unitPrice), "1": PESO(unitPrice * (countValid ? amount : 0)) })
                : tr("0 makes these tags free.")}
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Batch name (optional)")}</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder={tr("Freshman orientation pack")} className={INPUT} />
          </label>
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800">{error}</p>}
        </div>
      )}
    </AdminModal>
  );
}

/** A titled block of label and value rows inside the tag window (a quieter alternative to a wall of boxed cards). */
function TagFacts({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <section aria-label={tr(title)}>
      <h3 className="mb-1.5 text-[13px] font-semibold text-gold-700 dark:text-gold-300">{tr(title)}</h3>
      <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-[var(--surface)]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="shrink-0 text-[13.5px] text-ink-muted">{tr(label)}</dt>
            <dd className="min-w-0 break-words text-right text-[14px] font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TagModal({ tag, canBan, onClose, onDeactivate, onReactivate, onRenew, onEdit, onDelete }: { tag: AdminSmartTag; canBan: boolean; onClose: () => void; onDeactivate: () => void; onReactivate: () => void; onRenew: () => void; onEdit: () => void; onDelete: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [qr, setQr] = useState("");
  const [qrError, setQrError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [photo, setPhoto] = useState("");
  const [photoState, setPhotoState] = useState<"none" | "loading" | "ready" | "error">(tag.has_photo ? "loading" : "none");
  const state = tagState(tag);

  useEffect(() => {
    if (!tag.has_photo) { setPhotoState("none"); return undefined; }
    let active = true;
    setPhotoState("loading");
    fetchSmartTagPhoto(tag.tag_id).then(({ url }) => { if (active) { setPhoto(url ?? ""); setPhotoState(url ? "ready" : "error"); } }).catch(() => { if (active) setPhotoState("error"); });
    return () => { active = false; };
  }, [tag.tag_id, tag.has_photo]);

  useEffect(() => {
    let url = "";
    let active = true;
    fetchSmartTagQr(tag.tag_id).then((value) => { url = value; if (active) setQr(value); else URL.revokeObjectURL(value); }).catch(() => { if (active) setQrError(true); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [tag.tag_id]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(tag.url); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked: the URL is shown for manual copy */ }
  };

  const registered = tag.status !== "blank";
  const owner = tag.owner;
  const priceText = tag.price ? PESO(tag.price) : tr("Free");
  const guide = tag.tag_type === "rfid" ? tag.tag_id : tag.url;

  return (
    <AdminModal
      title={SPACED(tag.tag_id)}
      description={<span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1.5"><StatusPill tone={state.tone}>{state.label}</StatusPill><span>{tr("Batch: {0}", { "0": tag.batch_label || "—" })}</span></span>}
      icon={<QrCode size={21} />}
      size="xl"
      onClose={onClose}
      footer={<>
        {canBan && registered && (tag.is_disabled
          ? <button type="button" onClick={onReactivate} className={`${BTN.ghost} whitespace-nowrap sm:mr-auto`}><ShieldCheck size={16} aria-hidden="true" />{tr("Reactivate")}</button>
          : <button type="button" onClick={onDeactivate} className="inline-flex min-h-[42px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-rose-200 bg-rose-50 px-4 text-[14px] font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 sm:mr-auto dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/20"><Ban size={16} aria-hidden="true" />{tr("Deactivate tag")}</button>)}
        {canBan && isDeletableTag(tag) && <button type="button" onClick={onDelete} className={`${BTN.ghost} whitespace-nowrap text-rose-700 dark:text-rose-300 ${registered ? "" : "sm:mr-auto"}`}><Trash2 size={16} aria-hidden="true" />{tr("Delete tag")}</button>}
        {owner && registered && <button type="button" onClick={onEdit} className={`${BTN.ghost} whitespace-nowrap`}><Pencil size={16} aria-hidden="true" />{tr("Edit")}</button>}
        {owner && registered && tag.status !== "pending_verification" && <button type="button" onClick={onRenew} className={`${BTN.ghost} whitespace-nowrap`}><RotateCw size={16} aria-hidden="true" />{tr("Renew")}</button>}
        <button type="button" onClick={onClose} className={`${BTN.primary} whitespace-nowrap`}>{tr("Close")}</button>
      </>}
    >
      <div className="grid gap-6 lg:grid-cols-[272px_minmax(0,1fr)]">
        {/* The sticker: the QR on a navy and gold plate, with what staff do with it (copy the link, print the QR). */}
        <aside className="mx-auto w-full max-w-[300px] lg:max-w-none">
          <div className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(160deg,#22366a_0%,#162448_62%,#0e1830_100%)] p-4 shadow-[0_24px_50px_-28px_rgba(14,24,48,0.9)] ring-1 ring-white/10">
            <span aria-hidden="true" className="pointer-events-none absolute -right-14 -top-16 size-44 rounded-full bg-[radial-gradient(circle,rgba(209,161,83,0.4),transparent_68%)]" />
            <p className="relative mb-3 flex items-center justify-between text-[12px] font-semibold text-gold-300"><span className="inline-flex items-center gap-1.5"><QrCode size={13} aria-hidden="true" />E-Balik Smart Tag</span><span>{TYPE_LABEL[tag.tag_type] ?? "QR Code"}</span></p>
            <div className="relative flex aspect-square items-center justify-center rounded-2xl bg-white p-3 shadow-[inset_0_0_0_1px_rgba(14,24,48,0.06)]">
              {qr ? <img src={qr} alt={tr("QR code for Smart Tag {0}", { "0": tag.tag_id })} className="size-full" /> : qrError ? <span className="px-3 text-center text-[13px] text-rose-700">{tr("The QR code could not be created.")}</span> : <SkeletonBlock className="size-full rounded-xl" />}
            </div>
            <p className="relative mt-3 text-center font-mono text-[15px] font-semibold tracking-[0.14em] text-white">{SPACED(tag.tag_id)}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void copy()} className={`${BTN.ghost} !px-2 whitespace-nowrap`}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? tr("Copied") : tr("Copy link")}</button>
            {qr ? <a href={qr} download={`smart-tag-${tag.tag_id}.png`} className={`${BTN.ghost} !px-2 whitespace-nowrap`}><Download size={16} aria-hidden="true" />{tr("Download QR")}</a> : <span className={`${BTN.ghost} !px-2 opacity-50`}><Download size={16} aria-hidden="true" />{tr("Download QR")}</span>}
          </div>
          <p className="mt-3 break-all rounded-xl bg-frost-50 px-3 py-2 font-mono text-[11.5px] leading-5 text-ink-muted">{guide}</p>
        </aside>

        <div className="min-w-0 space-y-5">
          {tag.is_disabled && tag.disabled_reason && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] leading-6 text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200"><TriangleAlert size={15} className="mr-1.5 inline" aria-hidden="true" />{tr("Deactivated: {0}", { "0": tag.disabled_reason })}</p>}

          {registered && (
            <section className="space-y-4">
              {photoState !== "none" ? (
                <figure className="group relative overflow-hidden rounded-[22px] border border-line bg-navy-950 shadow-[0_18px_40px_-28px_rgba(14,24,48,0.9)]">
                  {photoState === "ready" ? (
                    <button type="button" onClick={() => setZoom(true)} className="relative block aspect-[4/3] max-h-[340px] w-full overflow-hidden" aria-label={tr("Open the photo full size")}>
                      {/* A soft, blurred copy fills the frame so a tall or wide photo never leaves empty black bars. */}
                      <img src={photo} alt="" aria-hidden="true" className="absolute inset-0 size-full scale-110 object-cover opacity-45 blur-2xl" />
                      <img src={photo} alt={tr("Photo of the item with its sticker, taken by the owner at registration")} className="relative mx-auto size-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" onError={() => setPhotoState("error")} />
                      <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-navy-950/70 px-3 py-1.5 text-[12px] font-semibold text-white opacity-90 ring-1 ring-white/15 backdrop-blur-md transition-opacity group-hover:opacity-100"><Expand size={13} aria-hidden="true" />{tr("View full size")}</span>
                    </button>
                  ) : photoState === "loading" ? <SkeletonBlock className="aspect-[4/3] max-h-[340px] w-full rounded-none" />
                    : <p className="flex aspect-[4/3] max-h-[340px] items-center justify-center px-4 text-center text-[13px] text-[#fecdd3]">{tr("The photo could not be loaded.")}</p>}
                  <figcaption className="absolute inset-x-0 bottom-0 bg-[linear-gradient(0deg,rgba(8,14,32,0.82),transparent)] px-4 pb-3 pt-8 text-[12.5px] font-medium text-white/90">{tr("Photo taken live by the owner at registration")}</figcaption>
                </figure>
              ) : <p className="rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-[12.5px] text-ink-muted">{tr("No registration photo. This tag was registered before photos were required.")}</p>}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-ink-muted">{tr("Item")}</p>
                  <p className="mt-0.5 font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight text-ink">{tag.item_name || tr("Not registered")}</p>
                </div>
                <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-frost-50 p-3 sm:max-w-[320px]">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-[13px] font-bold text-navy-950" aria-hidden="true">{(owner?.name || "?").split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-ink">{owner?.name || "—"}</p>
                    <p className="truncate text-[12px] text-ink-muted">{[owner?.campus_id, owner?.email].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          <TagFacts title="Lifecycle" rows={[
            ["Created", formatDateTime(tag.created_at)],
            ["Registered", tag.claimed_at ? formatDateTime(tag.claimed_at) : "—"],
            ["Validity", tag.validity_months ? tr("{0} from registration", { "0": monthsLabel(tag.validity_months) }) : tr("Never expires")],
            ["Valid until", tag.valid_until ? <span key="v" className="inline-flex flex-wrap items-center justify-end gap-2">{formatDateTime(tag.valid_until)}{tag.status === "expired" ? <StatusPill tone="rose">{tr("Expired")}</StatusPill> : tag.days_left !== null && <StatusPill tone={daysTone(tag.days_left)}>{daysText(tag.days_left)}</StatusPill>}</span> : "—"],
          ]} />

          <TagFacts title="Payment" rows={[
            ["Price", priceText],
            ["Status", tag.price ? (tag.paid_at ? <StatusPill key="s" tone="mint">{tr("Paid {0}", { "0": formatDateTime(tag.paid_at) })}</StatusPill> : registered ? <StatusPill key="s" tone="gold">{tr("Payment due at approval")}</StatusPill> : <span key="s" className="text-ink-muted">{tr("Paid when registered")}</span>) : tr("Free")],
          ]} />

          <TagFacts title="Activity" rows={[
            ["Times scanned", String(tag.scan_count)],
            ["Last scanned", tag.last_scanned_at ? formatDateTime(tag.last_scanned_at) : "—"],
            ["Finder alerts", tag.found_notice_count > 0 ? <StatusPill key="f" tone="iris">{tr("{0} finder alerts", { "0": tag.found_notice_count })}</StatusPill> : "0"],
            ["Last finder alert", tag.last_found_notice_at ? formatDateTime(tag.last_found_notice_at) : "—"],
          ]} />
        </div>
      </div>
      {zoom && photo && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(4,8,20,0.92)] p-4 backdrop-blur-md sm:p-10" role="dialog" aria-modal="true" aria-label={tr("Photo full size")} onClick={() => setZoom(false)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setZoom(false); } }}>
          <img src={photo} alt={tr("Photo of the item with its sticker, taken by the owner at registration")} className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10" onClick={(event) => event.stopPropagation()} />
          <button type="button" onClick={() => setZoom(false)} autoFocus className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/20" aria-label={tr("Close photo")}><CloseIcon size={20} aria-hidden="true" /></button>
          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-[12.5px] font-medium text-white/90 ring-1 ring-white/15">{SPACED(tag.tag_id)} · {tag.item_name}</p>
        </div>
      )}
    </AdminModal>
  );
}

/** Smart Tag revenue: a tag is sold when staff approve its registration at the office (recorded in the income ledger). */
function RevenueStrip({ revenue }: { revenue: SmartTagRevenue | null | undefined }) {
  if (revenue === undefined) return null;
  if (revenue === null) {
    return (
      <p className="flex items-start gap-2.5 rounded-2xl border border-dashed border-line-strong px-4 py-3 text-[13.5px] leading-5 text-ink-muted" role="status">
        <Banknote size={17} className="mt-0.5 shrink-0 text-gold-600" aria-hidden="true" />
        {tr("Revenue appears here once Server/manual_migrations/20261022_income_ledger.sql has been run in Supabase.")}
      </p>
    );
  }
  const cells = [
    { label: "Revenue from tags", value: PESO(revenue.total), hint: tr("Recorded when staff approve a registration") },
    { label: "This month", value: PESO(revenue.this_month), hint: tr("Manila time") },
    { label: "Tags sold", value: String(revenue.sold), hint: revenue.sold ? tr("Average {0} each", { "0": PESO(revenue.average) }) : tr("None yet") },
    { label: "Unsold stock value", value: PESO(revenue.stock_value), hint: tr("{0} priced blank tags", { "0": revenue.stock_count }) },
  ];
  return (
    <section className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#22366a_0%,#162448_62%,#0e1830_100%)] text-white shadow-[0_24px_60px_-36px_rgba(14,24,48,0.9)]" aria-label={tr("Smart Tag revenue")}>
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-[radial-gradient(circle,rgba(209,161,83,0.32),transparent_68%)]" />
      <dl className="relative grid grid-cols-2 lg:grid-cols-4">
        {cells.map((cell, index) => (
          <div key={cell.label} className={`px-5 py-4 sm:px-6 sm:py-5 ${index ? "lg:border-l lg:border-white/10" : ""} ${index < 2 ? "max-lg:border-b max-lg:border-white/10" : ""} ${index % 2 ? "max-lg:border-l max-lg:border-white/10" : ""}`}>
            <dt className="flex items-center gap-2 text-[13px] font-medium text-navy-100">{index === 0 && <Banknote size={15} className="text-gold-300" aria-hidden="true" />}{tr(cell.label)}</dt>
            <dd className={`mt-1.5 font-[family-name:var(--font-heading)] font-semibold leading-none tabular-nums ${index === 0 ? "text-[28px] text-gold-200" : "text-[24px]"}`}>{cell.value}</dd>
            <p className="mt-1.5 text-[12.5px] text-navy-200">{cell.hint}</p>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function SmartTags() {
  const [data, setData] = useState<SmartTagList | null>(null);
  const [filter, setFilter] = useState<TagFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [viewing, setViewing] = useState<AdminSmartTag | null>(null);
  const [banning, setBanning] = useState<AdminSmartTag | null>(null);
  const [banReason, setBanReason] = useState("");
  const [reviving, setReviving] = useState<AdminSmartTag | null>(null);
  const [renewing, setRenewing] = useState<AdminSmartTag | null>(null);
  const [reviewing, setReviewing] = useState<AdminSmartTag | null>(null);
  const [editing, setEditing] = useState<AdminSmartTag | null>(null);
  const [renewMonths, setRenewMonths] = useState("12");
  const [batches, setBatches] = useState<TagBatch[]>([]);
  const [batchBan, setBatchBan] = useState<TagBatch | null>(null);
  const [batchReason, setBatchReason] = useState("");
  const [batchRevive, setBatchRevive] = useState<TagBatch | null>(null);
  const [batchPricing, setBatchPricing] = useState<TagBatch | null>(null);
  const [removingTag, setRemovingTag] = useState<AdminSmartTag | null>(null);
  const [removingBatch, setRemovingBatch] = useState<TagBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const superAdmin = canDelete();

  const load = useCallback(async () => {
    try {
      setData(await fetchSmartTags(filter));
      setSetupError("");
      setLoadError("");
    } catch (reason) {
      if (reason instanceof SmartTagSetupError) setSetupError(reason.message);
      else setLoadError(reason instanceof Error ? reason.message : tr("Unable to load Smart Tags."));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  // Batches are grouped from every tag, so they load once and again after a change, not on every filter click.
  const loadBatches = useCallback(async () => {
    try { setBatches((await fetchTagBatches()).batches); } catch { /* the main list already explains a missing migration */ }
  }, []);
  useEffect(() => { void loadBatches(); }, [loadBatches]);

  const tags = data?.tags ?? [];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? tags.filter((t) => `${t.tag_id} ${t.item_name} ${t.batch_label} ${t.owner?.name ?? ""} ${t.owner?.email ?? ""}`.toLowerCase().includes(query)) : tags;
  }, [tags, search]);
  const paging = usePagination(filtered, 12, `${filter}|${search}`);
  const stats = data?.stats;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await Promise.all([load(), loadBatches()]);
      return true;
    } catch {
      return false; // the API helper already showed the failure
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => downloadCsv(filter === "blank" ? "smart-tags-blank" : "smart-tags",
    ["Tag code", "Type", "Status", "Item", "Owner", "Owner email", "Batch", "Created", "Registered", "Valid until", "Times scanned", "Value to write on the tag"],
    filtered.map((t) => [t.tag_id, TYPE_LABEL[t.tag_type] ?? "QR Code", tagState(t).label, t.item_name, t.owner?.name ?? "", t.owner?.email ?? "", t.batch_label, t.created_at, t.claimed_at ?? "", t.valid_until ?? "", String(t.scan_count), t.tag_type === "rfid" ? t.tag_id : t.url]));
  const expiringSoon = batches.reduce((sum, b) => sum + b.expiring_soon, 0);

  if (loading) {
    return <div className="space-y-5 p-4 sm:p-6" aria-busy="true"><div><SkeletonBlock className="mb-2 h-8 w-48" /><SkeletonBlock className="h-4 w-80" /></div><SkeletonBlock className="h-24 w-full rounded-2xl" /><AdminTableSkeleton columns={6} rows={6} /></div>;
  }
  if (setupError) {
    return (
      <div className="space-y-5 p-4 sm:p-6">
        <PageHeader title={tr("Smart tags")} description={tr("Generate QR stickers and watch them get registered.")} meta={<RolePill superAdmin={superAdmin} />} />
        <SetupNotice message={setupError} onRetry={() => { setLoading(true); void load(); }} />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={tr("Smart tags")}
        description={tr("Generate batches of blank QR tags to print, track which ones are sold and registered, and deactivate misuse.")}
        meta={<RolePill superAdmin={superAdmin} />}
        actions={<>
          <ExportButton onClick={exportCsv} disabled={!filtered.length} />
          <button type="button" onClick={() => setBatchOpen(true)} className={BTN.primary}><Layers size={17} aria-hidden="true" />{tr("Generate batch")}</button>
        </>}
      />

      <section className="glass-panel overflow-hidden" aria-label={tr("Smart tag summary")}>
        <dl className="grid grid-cols-2 lg:grid-cols-6 [&>*]:border-line max-lg:[&>*:nth-child(-n+4)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:divide-x lg:divide-line">
          {[
            { label: "Blank (unsold)", value: stats?.blank ?? 0, hint: tr("{0} generated in total", { "0": stats?.total ?? 0 }), icon: <Package size={16} aria-hidden="true" /> },
            { label: "Claimed (sold)", value: stats?.claimed ?? 0, hint: tr("Registered by an owner"), icon: <Tags size={16} aria-hidden="true" /> },
            { label: "Marked lost", value: stats?.lost ?? 0, hint: tr("Owners looking for the item"), icon: <TriangleAlert size={16} aria-hidden="true" /> },
            { label: "Expiring in 30 days", value: expiringSoon, hint: tr("Registered tags about to expire"), icon: <Hourglass size={16} aria-hidden="true" /> },
            { label: "Expired", value: stats?.expired ?? 0, hint: tr("Hidden from finders"), icon: <CalendarClock size={16} aria-hidden="true" /> },
            { label: "Deactivated", value: stats?.disabled ?? 0, hint: tr("Switched off by an admin"), icon: <ShieldOff size={16} aria-hidden="true" /> },
          ].map((stat) => (
            <div key={stat.label} className="px-5 py-4 sm:px-6 sm:py-5">
              <dt className="flex items-center gap-2 text-[13px] font-medium text-ink-muted"><span className="text-gold-600">{stat.icon}</span>{tr(stat.label)}</dt>
              <dd className="mt-1.5 font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-none tabular-nums text-ink">{stat.value}</dd>
              <p className="mt-1.5 text-[12.5px] text-ink-muted">{stat.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      <RevenueStrip revenue={data?.revenue} />

      {(stats?.pending ?? 0) > 0 && (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-gold-400/60 bg-gold-50 p-4 dark:border-gold-500/40 dark:bg-gold-500/10" role="status">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><ClipboardCheck size={19} /></span>
          <div className="min-w-0 flex-1">
            <p className="font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink">{tr("{0} tag(s) are waiting for your approval", { "0": stats?.pending ?? 0 })}</p>
            <p className="text-[13px] text-ink-muted">{tr("Compare each one with the real item before approving it.")}</p>
          </div>
          {filter !== "pending" && <button type="button" onClick={() => setFilter("pending")} className={BTN.gold}><ClipboardCheck size={16} aria-hidden="true" />{tr("Review now")}</button>}
        </section>
      )}

      {data?.url_check && !data.url_check.ok && (
        <section role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
          <TriangleAlert size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 text-[14px] leading-6">
            <p className="font-semibold">{tr("Do not print stickers yet")}</p>
            <p>{tr("QR codes would open {0}. {1}", { "0": data.url_check.url, "1": data.url_check.reason })}</p>
            <p>{tr("Set PUBLIC_SITE_URL on the server to your real site address, restart it, and reload this page. A printed QR code cannot be changed.")}</p>
          </div>
        </section>
      )}

      <BatchPanel batches={batches} superAdmin={superAdmin} onDeactivate={(b) => { setBatchReason(""); setBatchBan(b); }} onReactivate={setBatchRevive} onPrice={setBatchPricing} onDelete={setRemovingBatch} />
      {batchPricing && <BatchPriceModal batch={batchPricing} onClose={() => setBatchPricing(null)} onSaved={() => { setBatchPricing(null); void loadBatches(); }} />}

      {loadError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{loadError}</p>}

      <SegmentedFilter
        label="Tag status"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All", count: stats?.total },
          { value: "blank", label: "Blank", count: stats?.blank },
          { value: "pending", label: "Pending approval", count: stats?.pending },
          { value: "claimed", label: "Claimed", count: stats?.claimed },
          { value: "lost", label: "Lost", count: stats?.lost },
          { value: "expired", label: "Expired", count: stats?.expired },
          { value: "disabled", label: "Deactivated", count: stats?.disabled },
        ]}
      />

      <Toolbar>
        <SearchField value={search} onChange={setSearch} placeholder={tr("Search code, item, owner or batch")} />
      </Toolbar>

      <DataTable
        caption={tr("Smart tags")}
        minWidth={1040}
        columns={[
          { key: "code", label: "Tag code" },
          { key: "item", label: "Item" },
          { key: "owner", label: "Owner" },
          { key: "status", label: "Status" },
          { key: "date", label: "Registered" },
          { key: "valid", label: "Valid until" },
          { key: "actions", label: "Actions" },
        ]}
        isEmpty={paging.pageItems.length === 0}
        empty={tags.length === 0 && filter === "all"
          ? <span className="mx-auto block max-w-[46ch] leading-6">{tr("No Smart Tags yet. Choose Generate batch to create blank tags to print.")}</span>
          : tr("Nothing matches these filters. Clear them to see every record.")}
        footer={<TableFooter {...paging} onPage={paging.setPage} />}
      >
        {paging.pageItems.map((tag) => {
          const state = tagState(tag);
          return (
            <tr key={tag.tag_id} data-tone={state.tone}>
              <td><div className="font-mono text-[13.5px] font-semibold tracking-wide text-ink">{SPACED(tag.tag_id)}</div><div className="text-[12.5px] text-ink-muted">{TYPE_LABEL[tag.tag_type] ?? "QR Code"} · {tag.batch_label || "—"}</div></td>
              <td>{tag.item_name ? <span className="font-semibold text-ink">{tag.item_name}</span> : <span className="text-ink-muted">{tr("Not registered")}</span>}</td>
              <td>{tag.owner ? <><div className="font-medium text-ink">{tag.owner.name || "—"}</div><div className="max-w-[220px] truncate text-[12.5px] text-ink-muted" title={tag.owner.email}>{tag.owner.email}</div></> : <span className="text-ink-muted">—</span>}</td>
              <td><div className="flex flex-wrap items-center gap-1.5"><StatusPill tone={state.tone}>{tr(state.label)}</StatusPill>{tag.status === "pending_verification" && tag.is_reregistration && <StatusPill tone="slate">{tr("New photo")}</StatusPill>}{tag.found_notice_count > 0 && <StatusPill tone="iris">{`${tag.found_notice_count}×`}</StatusPill>}</div></td>
              <td className="whitespace-nowrap text-[13px] text-ink-muted">{tag.claimed_at ? formatDateTime(tag.claimed_at) : "—"}</td>
              <td><ValidityCell tag={tag} /></td>
              <RowActions>
                {tag.status === "pending_verification" && <IconAction label={`${tr("Review")} ${tag.tag_id}`} tone="gold" onClick={() => setReviewing(tag)} icon={<ClipboardCheck size={17} aria-hidden="true" />} />}
                <IconAction label={`${tr("View")} ${tag.tag_id}`} onClick={() => (tag.status === "pending_verification" ? setReviewing(tag) : setViewing(tag))} icon={<Eye size={17} aria-hidden="true" />} />
                <IconAction label={`${tr("QR code")} ${tag.tag_id}`} tone="gold" onClick={() => setViewing(tag)} icon={<QrCode size={16} aria-hidden="true" />} />
                {superAdmin && tag.status !== "blank" && (tag.is_disabled
                  ? <IconAction label={`${tr("Reactivate")} ${tag.tag_id}`} tone="success" onClick={() => setReviving(tag)} icon={<ShieldCheck size={17} aria-hidden="true" />} />
                  : <IconAction label={`${tr("Deactivate")} ${tag.tag_id}`} tone="danger" onClick={() => { setBanReason(""); setBanning(tag); }} icon={<Ban size={16} aria-hidden="true" />} />)}
                {superAdmin && isDeletableTag(tag) && <IconAction label={`${tr("Delete")} ${tag.tag_id}`} tone="danger" onClick={() => setRemovingTag(tag)} icon={<Trash2 size={16} aria-hidden="true" />} />}
              </RowActions>
            </tr>
          );
        })}
      </DataTable>

      {batchOpen && <BatchModal maxBatch={data?.max_batch ?? 500} tagTypes={data?.tag_types ?? [{ value: "qr", label: "QR Code", enabled: true }]} onClose={() => setBatchOpen(false)} onCreated={() => { void load(); void loadBatches(); }} />}

      {viewing && (
        <TagModal
          tag={tags.find((t) => t.tag_id === viewing.tag_id) ?? viewing}
          canBan={superAdmin}
          onClose={() => setViewing(null)}
          onDeactivate={() => { const t = viewing; setViewing(null); setBanReason(""); setBanning(t); }}
          onReactivate={() => { const t = viewing; setViewing(null); setReviving(t); }}
          onRenew={() => { const t = viewing; setViewing(null); setRenewMonths(String(t.validity_months ?? 12)); setRenewing(t); }}
          onEdit={() => { const t = viewing; setViewing(null); setEditing(t); }}
          onDelete={() => { const t = viewing; setViewing(null); setRemovingTag(t); }}
        />
      )}

      {reviewing && <VerificationModal tag={tags.find((t) => t.tag_id === reviewing.tag_id) ?? reviewing} onClose={() => setReviewing(null)} onDone={() => { void load(); void loadBatches(); }} />}
      {editing && <AdminTagEditModal tag={tags.find((t) => t.tag_id === editing.tag_id) ?? editing} onClose={() => setEditing(null)} onSaved={() => { void load(); void loadBatches(); }} />}

      {renewing && (
        <AdminModal
          title={tr("Renew {0}", { "0": SPACED(renewing.tag_id) })}
          description={renewing.status === "expired" ? tr("The tag works again from today and its owner is told.") : tr("The new months are added after the current end date and the owner is told.")}
          icon={<RotateCw size={19} />}
          size="sm"
          busy={busy}
          onClose={() => setRenewing(null)}
          footer={<>
            <button type="button" onClick={() => setRenewing(null)} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
            <button type="button" disabled={busy || !(Number(renewMonths) >= 1 && Number(renewMonths) <= 120)} onClick={() => void run(() => renewSmartTag(renewing.tag_id, Number(renewMonths))).then((ok) => { if (ok) setRenewing(null); })} className={BTN.primary}>{busy ? tr("Working…") : tr("Renew tag")}</button>
          </>}
        >
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Months to add")}</span>
            <input value={renewMonths} onChange={(event) => setRenewMonths(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={INPUT} data-autofocus />
            <span className="mt-1 block text-[12.5px] text-ink-muted">{tr("12 months is one academic year.")}</span>
          </label>
        </AdminModal>
      )}

      {batchBan && (
        <AdminModal
          title={tr("Deactivate the whole batch?")}
          description={tr("Every tag in {0} stops working at once, including blank ones, so a stolen roll cannot be registered. Owners are told why.", { "0": batchBan.label })}
          icon={<Ban size={19} />}
          tone="danger"
          size="sm"
          busy={busy}
          onClose={() => setBatchBan(null)}
          footer={<>
            <button type="button" onClick={() => setBatchBan(null)} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
            <button type="button" disabled={busy || batchReason.trim().length < 3 || !batchBan.batch_id} onClick={() => void run(() => deactivateTagBatch(batchBan.batch_id as string, batchReason.trim())).then((ok) => { if (ok) setBatchBan(null); })} className={BTN.danger}>{busy ? tr("Working…") : tr("Deactivate {0} tags", { "0": batchBan.total - batchBan.disabled })}</button>
          </>}
        >
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Reason (owners see this)")}</span>
            <textarea value={batchReason} onChange={(event) => setBatchReason(event.target.value)} rows={3} maxLength={300} data-autofocus placeholder={tr("This roll of stickers was reported stolen.")} className={`${INPUT} resize-y py-3 leading-6`} />
          </label>
        </AdminModal>
      )}

      {removingTag && (
        <ConfirmActionDialog
          title={tr("delete Smart Tag {0}?", { "0": SPACED(removingTag.tag_id) })}
          description={removingTag.status === "blank" ? "This blank tag is removed for good. A printed sticker with this code will no longer work." : "This deactivated tag and its photo are removed for good. Money already recorded for it stays in the income ledger."}
          confirmLabel="Delete tag"
          danger
          busy={busy}
          onCancel={() => { if (!busy) setRemovingTag(null); }}
          onConfirm={() => void run(() => deleteSmartTag(removingTag.tag_id)).then((ok) => { if (ok) setRemovingTag(null); })}
        />
      )}

      {removingBatch && (
        <ConfirmActionDialog
          title={tr("delete the unused tags of {0}?", { "0": removingBatch.label })}
          description={`${removingBatch.blank} blank and ${removingBatch.disabled} deactivated tags are removed for good. Tags people still use stay, and recorded income is kept.`}
          confirmLabel="Delete unused tags"
          danger
          busy={busy}
          onCancel={() => { if (!busy) setRemovingBatch(null); }}
          onConfirm={() => void run(() => deleteTagBatch(removingBatch.batch_id as string)).then((ok) => { if (ok) setRemovingBatch(null); })}
        />
      )}

      {batchRevive && (
        <ConfirmActionDialog
          title={tr("reactivate {0}?", { "0": batchRevive.label })}
          description="Every deactivated tag in this batch works again, including any that were switched off one by one."
          confirmLabel="Reactivate batch"
          busy={busy}
          onCancel={() => { if (!busy) setBatchRevive(null); }}
          onConfirm={() => void run(() => reactivateTagBatch(batchRevive.batch_id as string)).then(() => setBatchRevive(null))}
        />
      )}

      {banning && (
        <AdminModal
          title={tr("Deactivate {0}?", { "0": SPACED(banning.tag_id) })}
          description={tr("Finders will see nothing about the item or owner, and the owner cannot change the tag. The owner is told why.")}
          icon={<Ban size={19} />}
          tone="danger"
          size="sm"
          busy={busy}
          onClose={() => setBanning(null)}
          footer={<>
            <button type="button" onClick={() => setBanning(null)} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
            <button type="button" disabled={busy || banReason.trim().length < 3} onClick={() => void run(() => deactivateSmartTag(banning.tag_id, banReason.trim())).then((ok) => { if (ok) setBanning(null); })} className={BTN.danger}>{busy ? tr("Working…") : tr("Deactivate tag")}</button>
          </>}
        >
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Reason (the owner sees this)")}</span>
            <textarea value={banReason} onChange={(event) => setBanReason(event.target.value)} rows={3} maxLength={300} data-autofocus placeholder={tr("The tag was used to harass another student.")} className={`${INPUT} resize-y py-3 leading-6`} />
          </label>
        </AdminModal>
      )}

      {reviving && (
        <ConfirmActionDialog
          title={tr("reactivate {0}?", { "0": SPACED(reviving.tag_id) })}
          description="The tag works again: finders can see the details the owner chose to share."
          confirmLabel="Reactivate tag"
          busy={busy}
          onCancel={() => { if (!busy) setReviving(null); }}
          onConfirm={() => void run(() => reactivateSmartTag(reviving.tag_id)).then(() => setReviving(null))}
        />
      )}
    </div>
  );
}
