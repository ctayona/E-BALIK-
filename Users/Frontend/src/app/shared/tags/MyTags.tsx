import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BellRing, CalendarClock, Camera, Copy, Download, Hourglass, Pencil, QrCode, Settings2, ShieldAlert, ShieldCheck, Sticker, Tag as TagIcon, TriangleAlert } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import { SkeletonBlock } from "@/app/shared/LoadingSkeleton";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { showToast } from "@/app/shared/toast/toastStore";
import LivePhotoField from "@/app/shared/tags/LivePhotoField";
import ScanCodeButton from "@/app/shared/tags/ScanCodeButton";
import TagDetailsForm from "@/app/shared/tags/TagDetailsForm";
import { CX } from "@/app/utils/clay";
import { copyText } from "@/app/utils/shareReport";
import { TagRequestError, expiryText, extractTagCode, ownerQrUrl, spacedCode, tagsApi, type OwnerTag, type TagDetailsInput } from "@/app/utils/tags";

const SOON_DAYS = 30;
type Filter = "all" | "active" | "lost" | "expiring" | "expired";

const usable = (tag: OwnerTag) => !tag.is_disabled && (tag.status === "active" || tag.status === "lost");
const expiringSoon = (tag: OwnerTag) => usable(tag) && tag.days_left != null && tag.days_left <= SOON_DAYS;
const FILTERS: Array<{ value: Filter; label: string; test: (tag: OwnerTag) => boolean }> = [
  { value: "all", label: "All", test: () => true },
  { value: "active", label: "Active", test: (tag) => !tag.is_disabled && tag.status === "active" },
  { value: "lost", label: "Lost", test: (tag) => !tag.is_disabled && tag.status === "lost" },
  { value: "expiring", label: "Expiring", test: expiringSoon },
  { value: "expired", label: "Expired", test: (tag) => !tag.is_disabled && tag.status === "expired" },
];

/** One badge per state, colour-coded: Active (mint), Lost (gold), Expired (rose), Awaiting approval (amber), Disabled (slate). */
function StatusBadge({ tag }: { tag: OwnerTag }) {
  const base = "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1";
  if (tag.is_disabled) return <span className={`${base} bg-slate-100 text-slate-700 ring-slate-300`}><ShieldAlert size={12} aria-hidden="true" />Disabled</span>;
  if (tag.status === "pending_verification") return <span className={`${base} bg-[#fef3c7] text-[#78350f] ring-[#f5c451]`}><Hourglass size={12} aria-hidden="true" />Awaiting approval</span>;
  if (tag.status === "expired") return <span className={`${base} bg-rose-50 text-rose-800 ring-rose-200`}><CalendarClock size={12} aria-hidden="true" />Expired</span>;
  if (tag.status === "lost") return <span className={`${base} bg-gold-50 text-gold-800 ring-gold-300`}><TriangleAlert size={12} aria-hidden="true" />Lost</span>;
  return <span className={`${base} bg-tide-50 text-tide-700 ring-tide-200`}><ShieldCheck size={12} aria-hidden="true" />Active</span>;
}

function DaysPill({ tag }: { tag: OwnerTag }) {
  if (!usable(tag)) return null;
  if (tag.days_left == null) return <span className="rounded-full bg-frost-100 px-2.5 py-1 text-[12px] font-semibold text-ink-soft ring-1 ring-line">No expiry</span>;
  const soon = tag.days_left <= SOON_DAYS;
  return (
    <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums ring-1 ${soon ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-frost-100 text-ink-soft ring-line"}`}>
      {tag.days_left <= 0 ? "Expires today" : `${tag.days_left} ${tag.days_left === 1 ? "day" : "days"} left`}
    </span>
  );
}

/** The tag's own QR code (from the server, owner only), or a QR icon while it loads or when it cannot be shown. */
function TagQr({ tagId, size = "card" }: { tagId: string; size?: "card" | "large" }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    ownerQrUrl(tagId).then((url) => { if (active) setSrc(url); }).catch(() => { if (active) setSrc(""); });
    return () => { active = false; };
  }, [tagId]);
  const box = size === "large" ? "size-[220px] rounded-3xl p-3" : "size-full rounded-2xl p-2.5";
  return src ? (
    <img src={src} alt={`QR code of tag ${spacedCode(tagId)}`} width={220} height={220} decoding="async" className={`${box} bg-[#ffffff] object-contain`} />
  ) : (
    <span className={`${box} flex items-center justify-center bg-[#ffffff] text-navy-300`} aria-hidden="true"><QrCode size={size === "large" ? 96 : 52} strokeWidth={1.4} /></span>
  );
}

function EmptyIllustration() {
  return (
    <svg viewBox="0 0 220 150" className="mx-auto h-[130px] w-auto" role="img" aria-label="A laptop with a Smart Tag sticker and a phone scanning it">
      <defs>
        <linearGradient id="tag-gold" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#f3dcab" /><stop offset="1" stopColor="#d1a153" /></linearGradient>
        <linearGradient id="tag-navy" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#33497f" /><stop offset="1" stopColor="#1f3160" /></linearGradient>
      </defs>
      <circle cx="110" cy="78" r="64" fill="#d1a153" opacity="0.12" />
      <rect x="38" y="44" width="104" height="66" rx="8" fill="url(#tag-navy)" />
      <rect x="44" y="50" width="92" height="54" rx="4" fill="#0e1830" />
      <rect x="28" y="110" width="124" height="9" rx="4.5" fill="#1f3160" />
      <rect x="104" y="58" width="24" height="24" rx="5" fill="url(#tag-gold)" />
      <path d="M109 63h5v5h-5zM118 63h5v5h-5zM109 72h5v5h-5zM118 72h2v2h-2zM121 75h2v2h-2z" fill="#0e1830" />
      <rect x="150" y="54" width="38" height="66" rx="8" fill="#ffffff" stroke="#1f3160" strokeWidth="3" />
      <rect x="158" y="66" width="22" height="22" rx="3" fill="none" stroke="#d1a153" strokeWidth="2.5" strokeDasharray="5 3" />
      <circle cx="169" cy="104" r="4" fill="#d1a153" />
      <path d="M140 70 q6 -6 12 0" fill="none" stroke="#d1a153" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** The three steps of a Smart Tag. Shown in the page hero and, for someone with no tags yet, in the empty state. */
export const TAG_STEPS = [
  { title: "Register", text: "Scan the sticker's QR code and take a photo of your item with it.", icon: <QrCode size={18} aria-hidden="true" /> },
  { title: "Stick", text: "Put the sticker somewhere visible: laptop lid, bag, bottle, keys.", icon: <Sticker size={18} aria-hidden="true" /> },
  { title: "Get notified", text: "Whoever finds it scans the code, and we tell you right away.", icon: <BellRing size={18} aria-hidden="true" /> },
];

/** The Smart Tags you own, as a filterable card grid. Manage opens one window with the tag's QR code and every action. */
export default function MyTags({ onLoaded, onRegister, reloadKey = 0 }: {
  onLoaded?: (tags: OwnerTag[]) => void;
  /** Opens the in-page registration dialog (with the live camera), optionally with the code already known. */
  onRegister?: (code?: string) => void;
  /** Change this number to make the list reload, for example after a tag was registered. */
  reloadKey?: number;
}) {
  const reduced = useReducedMotion();
  const [tags, setTags] = useState<OwnerTag[] | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [managing, setManaging] = useState<OwnerTag | null>(null);
  const [editing, setEditing] = useState<OwnerTag | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [switching, setSwitching] = useState<string | null>(null);
  const [photoFor, setPhotoFor] = useState<OwnerTag | null>(null);
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState("");

  const replaceTag = useCallback((next: OwnerTag) => {
    setTags((current) => { const list = (current ?? []).map((t) => (t.tag_id === next.tag_id ? next : t)); onLoaded?.(list); return list; });
    setManaging((current) => (current && current.tag_id === next.tag_id ? next : current));
  }, [onLoaded]);

  const load = useCallback(async () => {
    try {
      const loaded = (await tagsApi.mine()).tags;
      setTags(loaded);
      onLoaded?.(loaded);
      setSetup(false);
      setError("");
    } catch (reason) {
      if (reason instanceof TagRequestError && reason.setupRequired) { setSetup(true); setTags([]); onLoaded?.([]); return; }
      setError(reason instanceof Error ? reason.message : "Unable to load your Smart Tags.");
      setTags((current) => current ?? []);
    }
  }, [onLoaded]);

  useEffect(() => {
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);

  useEffect(() => { if (reloadKey) void load(); }, [reloadKey, load]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, (tags ?? []).filter(f.test).length])) as Record<Filter, number>, [tags]);
  const shown = useMemo(() => (tags ?? []).filter(FILTERS.find((f) => f.value === filter)!.test), [tags, filter]);
  const pendingCount = (tags ?? []).filter((tag) => tag.status === "pending_verification").length;

  const open = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = extractTagCode(code);
    if (!clean) { setCodeError("That does not look like a tag code. Enter the 10 to 12 characters printed on the sticker, or paste its link."); return; }
    if (onRegister) { onRegister(clean); setCode(""); return; }
    window.location.assign(`/tag/${clean}`);
  };

  const savePhoto = async () => {
    if (!photoFor || !newPhoto) return;
    setSaving(true);
    setPhotoError("");
    try {
      const result = await tagsApi.photo(photoFor.tag_id, newPhoto);
      replaceTag(result.tag);
      setPhotoFor(null);
      setNewPhoto(null);
      showInfoModal({ variant: "success", title: "Photo sent for approval", message: result.tag.status === "pending_verification" ? "Staff will review your photo. Your tag works again as soon as they approve it." : "Photo saved." });
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : "Unable to save the photo.");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (tag: OwnerTag, status: "active" | "lost") => {
    setSwitching(tag.tag_id);
    try {
      const result = await tagsApi.update(tag.tag_id, { status });
      replaceTag(result.tag);
      showInfoModal({
        variant: status === "lost" ? "warning" : "success",
        title: status === "lost" ? "Marked as lost" : "Marked as found",
        message: status === "lost"
          ? `Anyone who scans the tag on "${tag.item_name}" will see that it is lost, and you will be notified by email and in the app when someone reports finding it.${result.tag.lost_report ? ` We also posted a missing report for it (${result.tag.lost_report}). Find it under My Reports.` : ""}`
          : `"${tag.item_name}" is active again. Earlier finder alerts were cleared${result.tag.closed_reports?.length ? ` and the missing report ${result.tag.closed_reports.join(", ")} was closed` : ""}.`,
      });
    } catch (reason) {
      showInfoModal({ variant: "error", title: "Tag not updated", message: reason instanceof Error ? reason.message : "Unable to update the tag." });
    } finally {
      setSwitching(null);
    }
  };

  const save = async (values: TagDetailsInput, _consent: boolean, photo: File | null) => {
    if (!editing) return;
    setSaving(true);
    setFormError("");
    try {
      let result = await tagsApi.update(editing.tag_id, values);
      if (photo) result = await tagsApi.photo(editing.tag_id, photo);
      replaceTag(result.tag);
      setEditing(null);
      showInfoModal(photo
        ? { variant: "warning", title: "Sent for approval", message: "Your changes are saved. The new photo is waiting for staff approval, and your tag is paused until they approve it." }
        : { variant: "success", title: "Smart Tag updated", message: "Your changes are saved. The page finders see now follows your new privacy choices." });
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Unable to save the tag.");
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async (tag: OwnerTag) => {
    showToast((await copyText(tag.url)) ? "Tag link copied" : `Could not copy automatically. The link is ${tag.url}`, "success");
  };

  const downloadQr = async (tag: OwnerTag) => {
    try {
      const url = await ownerQrUrl(tag.tag_id);
      const link = document.createElement("a");
      link.href = url;
      link.download = `smart-tag-${tag.tag_id}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      showToast("The QR image could not be downloaded. Try again.", "error");
    }
  };

  const m = managing;
  const canChange = (tag: OwnerTag) => !tag.is_disabled && tag.status !== "expired";

  return (
    <section aria-labelledby="my-tags-list" className="space-y-5">
      <h2 id="my-tags-list" className="sr-only">Your Smart Tags</h2>
      {tags === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-[300px] w-full rounded-[24px]" />)}</div>
      ) : (
        <>
          {error && <p role="alert" className={CX.alertError}>{error} <button type="button" onClick={() => void load()} className="font-semibold underline">Try again</button></p>}
          {setup && <p className={CX.alertInfo}>Smart Tags are opening soon. You will be able to register your stickers here.</p>}
          {pendingCount > 0 && (
            <p className="flex items-start gap-2.5 rounded-2xl border border-[#f5c451] bg-[#fef3c7] px-4 py-3 text-[13.5px] leading-6 text-[#78350f]" role="status"><Hourglass size={17} className="mt-1 shrink-0" aria-hidden="true" />{pendingCount === 1 ? "One of your tags is" : `${pendingCount} of your tags are`} waiting for staff approval. Bring the item to the Lost and Found Office so they can check it.</p>
          )}

          {tags.length === 0 && !setup && !error && (
            <div className="relative overflow-hidden rounded-[28px] border border-white/80 bg-white/85 px-5 py-9 text-center shadow-card ring-1 ring-navy-900/[0.04] backdrop-blur-xl sm:px-10">
              <span className="pointer-events-none absolute inset-x-16 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.85),transparent)]" aria-hidden="true" />
              <EmptyIllustration />
              <h3 className="mt-4 font-[family-name:var(--font-heading)] text-[24px] font-semibold tracking-[-0.01em] text-ink">Protect something you can't afford to lose</h3>
              <p className="mx-auto mt-1.5 max-w-[48ch] text-[14.5px] leading-6 text-ink-muted">A Smart Tag is a QR sticker linked to you. Registering one takes about a minute: have the sticker and the item with you.</p>
              <ol className="mx-auto mt-6 grid max-w-[760px] gap-3 text-left sm:grid-cols-3">
                {TAG_STEPS.map((step, index) => (
                  <li key={step.title} className="rounded-2xl border border-line bg-frost-50/80 p-4">
                    <span className="flex items-center gap-2 text-[14.5px] font-semibold text-ink"><span className="flex size-7 items-center justify-center rounded-full bg-navy-800 text-[12.5px] font-bold text-gold-300">{index + 1}</span>{step.title}</span>
                    <span className="mt-1.5 block text-[13px] leading-5 text-ink-muted">{step.text}</span>
                  </li>
                ))}
              </ol>
              {onRegister && (
                <button type="button" onClick={() => onRegister()} className={`${CX.btnGold} mt-7 min-h-[56px] px-8 text-[16px] shadow-[0_18px_36px_-16px_rgba(209,161,83,0.95)]`}>
                  <Camera size={19} aria-hidden="true" />Register your first tag
                </button>
              )}
            </div>
          )}

          {tags.length > 0 && (
            <>
              <div role="tablist" aria-label="Filter your tags" className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-2xl border border-white/80 bg-white/85 p-1.5 shadow-card ring-1 ring-navy-900/[0.04] backdrop-blur-xl">
                {FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={filter === option.value}
                    onClick={() => setFilter(option.value)}
                    className={`relative flex min-h-[44px] flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 text-[14px] font-semibold transition-colors ${filter === option.value ? "text-white" : "text-ink-soft hover:bg-frost-100"}`}
                  >
                    {filter === option.value && (
                      <motion.span layoutId="tag-filter" className="absolute inset-0 rounded-xl bg-[linear-gradient(180deg,#2e4687_0%,#1f3160_100%)] shadow-[0_8px_18px_-8px_rgba(31,49,96,0.9)]" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }} />
                    )}
                    <span className="relative">{option.label}</span>
                    <span className={`relative min-w-[20px] rounded-full px-1.5 text-center text-[12px] tabular-nums ${filter === option.value ? "bg-white/20 text-gold-200" : "bg-frost-100 text-ink-muted"}`}>{counts[option.value]}</span>
                  </button>
                ))}
              </div>

              {shown.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line-strong bg-white/60 px-5 py-8 text-center text-[14.5px] text-ink-muted">No tags in this group.</p>
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {shown.map((tag) => (
                    <li key={tag.tag_id}>
                      <article className={`group flex h-full flex-col overflow-hidden rounded-[24px] border bg-white/90 shadow-card ring-1 ring-navy-900/[0.04] transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-raised ${
                        tag.status === "lost" && !tag.is_disabled ? "border-gold-300" : tag.status === "pending_verification" ? "border-[#f5c451]" : "border-white/80"
                      }`}>
                        <div className="relative bg-[radial-gradient(120%_90%_at_20%_0%,#33497f_0%,#1f3160_55%,#0e1830_100%)] p-5">
                          <div className="mx-auto size-[156px] shadow-[0_18px_36px_-18px_rgba(0,0,0,0.9)]"><TagQr tagId={tag.tag_id} /></div>
                          {tag.photo_url && <img src={tag.photo_url} alt="" decoding="async" loading="lazy" className="absolute bottom-3 right-3 size-12 rounded-xl object-cover ring-2 ring-white/80" />}
                          <span className="absolute left-3 top-3"><StatusBadge tag={tag} /></span>
                        </div>
                        <div className="flex flex-1 flex-col gap-2 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="truncate text-[16.5px] font-semibold text-ink">{tag.item_name || "Unnamed"}</h3>
                              <p className="font-mono text-[12.5px] tracking-wider text-ink-muted">{spacedCode(tag.tag_id)}</p>
                            </div>
                            <DaysPill tag={tag} />
                          </div>
                          {tag.found_notice_count > 0 && <p className="flex items-center gap-1.5 text-[13px] text-ink-soft"><BellRing size={14} className="text-gold-700" aria-hidden="true" />{tag.found_notice_count} {tag.found_notice_count === 1 ? "person reported finding it" : "reports of it being found"}</p>}
                          <button type="button" onClick={() => setManaging(tag)} className={`${CX.btnNavy} mt-auto min-h-[44px] w-full`}><Settings2 size={16} aria-hidden="true" />Manage</button>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <form onSubmit={open} className="rounded-[22px] border border-gold-300/50 bg-[linear-gradient(135deg,rgba(209,161,83,0.14),rgba(209,161,83,0.03)_65%)] p-4 sm:p-5" noValidate>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
              <div className="flex items-start gap-3 lg:w-[36%] lg:shrink-0">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><QrCode size={20} /></span>
                <div className="min-w-0">
                  <label htmlFor="tag-code-input" className="block text-[15.5px] font-semibold text-ink">Got a new sticker?</label>
                  <p className="text-[13px] leading-5 text-ink-muted">Type the code printed on it or scan its QR code, then take a photo of your item.</p>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex min-w-0 flex-1 gap-2">
                    <input id="tag-code-input" value={code} onChange={(e) => { setCode(e.target.value); setCodeError(""); }} placeholder="ABCD EFGH JK23" autoComplete="off" autoCapitalize="characters" spellCheck={false} className={`${CX.input} min-w-0 flex-1 font-mono tracking-wider`} />
                    <ScanCodeButton compact onCode={(scanned) => { if (onRegister) onRegister(scanned); else window.location.assign(`/tag/${scanned}`); }} />
                  </div>
                  <button type="submit" disabled={!code.trim()} className={`${CX.btnGold} min-h-[48px] px-7`}>Continue</button>
                </div>
                {codeError && <p role="alert" className="mt-2 text-[13px] text-rose-700">{codeError}</p>}
              </div>
            </div>
          </form>
        </>
      )}

      {/* Manage: the tag's QR code, its link and state, and every action, in one window. */}
      <Modal
        open={Boolean(m)}
        onClose={() => setManaging(null)}
        size="md"
        tone="navy"
        icon={<TagIcon size={20} />}
        eyebrow={m ? `Tag ${spacedCode(m.tag_id)}` : undefined}
        title={m ? m.item_name || "Unnamed" : ""}
        description={m ? expiryText(m) ?? (usable(m) ? "This tag never expires." : undefined) : undefined}
      >
        {m && (
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-[radial-gradient(120%_90%_at_20%_0%,#33497f_0%,#1f3160_55%,#0e1830_100%)] p-5">
              <TagQr tagId={m.tag_id} size="large" />
              <div className="flex flex-wrap justify-center gap-2">
                <StatusBadge tag={m} />
                <DaysPill tag={m} />
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => void downloadQr(m)} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-white/10 px-3.5 text-[13.5px] font-semibold text-white ring-1 ring-white/20 hover:bg-white/15"><Download size={15} aria-hidden="true" />Download QR</button>
                <button type="button" onClick={() => void copyLink(m)} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-white/10 px-3.5 text-[13.5px] font-semibold text-white ring-1 ring-white/20 hover:bg-white/15"><Copy size={15} aria-hidden="true" />Copy link</button>
              </div>
            </div>

            {m.is_disabled && <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] leading-5 text-rose-800"><ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />An administrator deactivated this tag{m.disabled_reason ? `: ${m.disabled_reason}` : "."}</p>}
            {m.status === "pending_verification" && (
              <p className="flex items-start gap-2 rounded-xl border border-[#f5c451] bg-[#fef3c7] px-3 py-2 text-[13px] leading-5 text-[#78350f]">
                <Hourglass size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{m.is_reregistration ? "Your new photo is waiting for staff approval. Your tag is paused until then and finders see nothing." : `Bring this item and its sticker to the Lost and Found Office${m.price && !m.paid ? ` and pay ₱${m.price.toLocaleString("en-PH", { minimumFractionDigits: 2 })} for the tag` : ""}. Staff will check it, then the tag starts working. Finders see nothing until then.`}</span>
              </p>
            )}
            {m.status === "expired" && <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] leading-5 text-rose-800"><CalendarClock size={15} className="mt-0.5 shrink-0" aria-hidden="true" />Finders can no longer see your details. Ask the Lost and Found Office to renew it.</p>}
            {expiringSoon(m) && <p className="flex items-start gap-2 rounded-xl border border-gold-300 bg-gold-50 px-3 py-2 text-[13px] leading-5 text-gold-800"><CalendarClock size={15} className="mt-0.5 shrink-0" aria-hidden="true" />Ask the Lost and Found Office to renew it before it expires.</p>}
            {m.found_notice_count > 0 && <p className="flex items-center gap-2 text-[13.5px] text-ink-soft"><BellRing size={15} className="text-gold-700" aria-hidden="true" />{m.found_notice_count} {m.found_notice_count === 1 ? "person reported finding it" : "reports of it being found"}</p>}

            <div className="grid gap-2 sm:grid-cols-3">
              {canChange(m) && m.status !== "pending_verification" && (
                m.status === "lost"
                  ? <button type="button" disabled={switching === m.tag_id} onClick={() => void setStatus(m, "active")} className={`${CX.btnGold} min-h-[46px]`}>I found it</button>
                  : <button type="button" disabled={switching === m.tag_id} onClick={() => void setStatus(m, "lost")} className={`${CX.btnGhost} min-h-[46px] border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50`}><TriangleAlert size={15} aria-hidden="true" />Mark as lost</button>
              )}
              {canChange(m) && <button type="button" onClick={() => { setFormError(""); setEditing(m); setManaging(null); }} className={`${CX.btnGhost} min-h-[46px]`}><Pencil size={15} aria-hidden="true" />Edit details</button>}
              {canChange(m) && <button type="button" onClick={() => { setPhotoError(""); setNewPhoto(null); setPhotoFor(m); setManaging(null); }} className={`${m.photo_url ? CX.btnGhost : CX.btnGold} min-h-[46px]`}><Camera size={15} aria-hidden="true" />{m.photo_url ? "Retake photo" : "Add photo"}</button>}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => { if (!saving) setEditing(null); }}
        dismissible={!saving}
        size="md"
        tone="gold"
        icon={<Pencil size={20} />}
        eyebrow={editing ? `Tag ${spacedCode(editing.tag_id)}` : undefined}
        title="Edit Smart Tag"
        description="Changes apply to the page finders see as soon as you save."
      >
        {editing && <TagDetailsForm key={editing.tag_id} mode="edit" initial={editing} submitLabel="Save changes" busy={saving} error={formError} onSubmit={(values, consent, photo) => void save(values, consent, photo)} onCancel={() => setEditing(null)} />}
      </Modal>

      <Modal
        open={Boolean(photoFor)}
        onClose={() => { if (!saving) { setPhotoFor(null); setNewPhoto(null); } }}
        dismissible={!saving}
        size="md"
        tone="gold"
        icon={<Camera size={20} />}
        eyebrow={photoFor ? `Tag ${spacedCode(photoFor.tag_id)}` : undefined}
        title={photoFor?.photo_url ? "Retake the photo" : "Add a photo"}
        description="Take a new photo of your item with the sticker attached."
        footer={<>
          <button type="button" onClick={() => { setPhotoFor(null); setNewPhoto(null); }} disabled={saving} className={CX.btnGhost}>Cancel</button>
          <button type="button" onClick={() => void savePhoto()} disabled={saving || !newPhoto} className={CX.btnGold}>{saving ? "Sending…" : photoFor?.status === "pending_verification" ? "Replace photo" : "Submit for approval"}</button>
        </>}
      >
        {photoFor && (
          <div className="space-y-3">
            {photoFor.status !== "pending_verification" && (
              <p className="flex items-start gap-2 rounded-2xl border border-[#f5c451] bg-[#fef3c7] px-4 py-3 text-[13.5px] leading-6 text-[#78350f]"><Hourglass size={16} className="mt-1 shrink-0" aria-hidden="true" />Changing the photo needs staff approval. Your tag stops working and finders see nothing until staff approve the new photo.</p>
            )}
            <LivePhotoField file={newPhoto} existingUrl={photoFor.photo_url} onChange={setNewPhoto} required />
            {photoError && <p role="alert" className={CX.alertError}>{photoError}</p>}
          </div>
        )}
      </Modal>
    </section>
  );
}
