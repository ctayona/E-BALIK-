import { useCallback, useEffect, useState } from "react";
import { BellRing, CalendarClock, Pencil, QrCode, ShieldAlert, Tag as TagIcon, TriangleAlert } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import { SkeletonBlock } from "@/app/shared/LoadingSkeleton";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import TagDetailsForm from "@/app/shared/tags/TagDetailsForm";
import { CX } from "@/app/utils/clay";
import { TagRequestError, expiryText, extractTagCode, spacedCode, tagsApi, type OwnerTag, type TagDetailsInput } from "@/app/utils/tags";

function StatusChip({ tag }: { tag: OwnerTag }) {
  if (tag.is_disabled) return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[12px] font-semibold text-rose-800 ring-1 ring-rose-200">Deactivated</span>;
  if (tag.status === "expired") return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[12px] font-semibold text-rose-800 ring-1 ring-rose-200"><CalendarClock size={12} aria-hidden="true" />Expired</span>;
  if (tag.status === "lost") return <span className="inline-flex items-center gap-1 rounded-full bg-gold-50 px-2.5 py-1 text-[12px] font-semibold text-gold-800 ring-1 ring-gold-200"><TriangleAlert size={12} aria-hidden="true" />Marked lost</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-tide-50 px-2.5 py-1 text-[12px] font-semibold text-tide-700 ring-1 ring-tide-200">Active</span>;
}

/** Dashboard section: the tags you own, quick lost/found switch, edit, and a way to register a new sticker by its code. */
export default function MyTags({ standalone = false, onLoaded }: {
  /** On its own page the page supplies the heading, so the card header is hidden and tags use more columns. */
  standalone?: boolean;
  onLoaded?: (tags: OwnerTag[]) => void;
}) {
  const [tags, setTags] = useState<OwnerTag[] | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [editing, setEditing] = useState<OwnerTag | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [switching, setSwitching] = useState<string | null>(null);

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

  const open = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = extractTagCode(code);
    if (!clean) { setCodeError("That does not look like a tag code. Enter the 10 to 12 characters printed on the sticker, or paste its link."); return; }
    window.location.assign(`/tag/${clean}`);
  };

  const setStatus = async (tag: OwnerTag, status: "active" | "lost") => {
    setSwitching(tag.tag_id);
    try {
      const result = await tagsApi.update(tag.tag_id, { status });
      setTags((current) => { const next = (current ?? []).map((t) => (t.tag_id === tag.tag_id ? result.tag : t)); onLoaded?.(next); return next; });
      showInfoModal({
        variant: status === "lost" ? "warning" : "success",
        title: status === "lost" ? "Marked as lost" : "Marked as found",
        message: status === "lost" ? `Anyone who scans the tag on "${tag.item_name}" will see that it is lost, and you will be notified when someone reports finding it.` : `"${tag.item_name}" is active again.`,
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
      setTags((current) => { const next = (current ?? []).map((t) => (t.tag_id === editing.tag_id ? result.tag : t)); onLoaded?.(next); return next; });
      setEditing(null);
      showInfoModal({ variant: "success", title: "Smart Tag updated", message: "Your changes are saved. The page finders see now follows your new privacy choices." });
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Unable to save the tag.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="my-tags-heading" className={`${CX.card} overflow-hidden`}>
      <header className={`${standalone ? "sr-only" : "flex"} flex-wrap items-center gap-3 border-b border-line px-5 py-4 sm:px-6`}>
        <span className="flex size-10 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300" aria-hidden="true"><QrCode size={19} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="my-tags-heading" className="font-[family-name:var(--font-heading)] text-[20px] font-semibold text-navy-800">My Smart Tags</h2>
          <p className="text-[13.5px] text-ink-muted">QR stickers that help strangers return your things to you.</p>
        </div>
      </header>

      <div className="space-y-4 p-5 sm:p-6">
        {tags === null ? <SkeletonBlock className="h-24 w-full rounded-2xl" /> : (
          <>
            {error && <p role="alert" className={CX.alertError}>{error} <button type="button" onClick={() => void load()} className="font-semibold underline">Try again</button></p>}
            {setup && <p className={CX.alertInfo}>Smart Tags are opening soon. You will be able to register your stickers here.</p>}

            {tags.length === 0 && !setup && !error && (
              <div className="rounded-2xl border border-dashed border-line-strong bg-frost-50 px-5 py-8 text-center">
                <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><TagIcon size={22} /></span>
                <p className="mt-3 text-[16px] font-semibold text-ink">Protect something you can't afford to lose</p>
                <p className="mx-auto mt-1 max-w-[46ch] text-[14px] leading-6 text-ink-muted">Stick a Smart Tag on your laptop, bag or bottle. If someone finds it, they scan the code and you are notified right away.</p>
              </div>
            )}

            {tags.length > 0 && (
              <ul className={`grid gap-3 md:grid-cols-2 ${standalone ? "xl:grid-cols-3" : ""}`}>
                {tags.map((tag) => (
                  <li key={tag.tag_id} className={`flex flex-col gap-3 rounded-2xl border p-4 ${tag.status === "lost" && !tag.is_disabled ? "border-gold-300 bg-gold-50" : tag.status === "expired" ? "border-rose-200 bg-rose-50/40" : "border-line bg-white"}`}>
                    <div className="flex items-start gap-3">
                      {tag.photo_url && <img src={tag.photo_url} alt="" decoding="async" loading="lazy" className="size-14 shrink-0 rounded-xl border border-line object-cover" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[16px] font-semibold text-ink">{tag.item_name || "Registered item"}</p>
                        <p className="font-mono text-[12.5px] tracking-wide text-ink-muted">{spacedCode(tag.tag_id)}</p>
                      </div>
                      <StatusChip tag={tag} />
                    </div>
                    {tag.is_disabled && <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] leading-5 text-rose-800"><ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />An administrator deactivated this tag{tag.disabled_reason ? `: ${tag.disabled_reason}` : "."}</p>}
                    {expiryText(tag) && (
                      <p className={`flex items-start gap-2 text-[13px] leading-5 ${tag.status === "expired" ? "rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800" : tag.days_left != null && tag.days_left <= 30 ? "rounded-xl border border-gold-300 bg-gold-50 px-3 py-2 text-gold-800" : "text-ink-soft"}`}>
                        <CalendarClock size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span>{expiryText(tag)}{tag.status === "expired" ? ". Finders can no longer see your details. Ask the Lost and Found Office to renew it." : tag.days_left != null && tag.days_left <= 30 ? ". Ask the Lost and Found Office to renew it before then." : ""}</span>
                      </p>
                    )}
                    {tag.found_notice_count > 0 && <p className="flex items-center gap-2 text-[13px] text-ink-soft"><BellRing size={14} className="text-gold-700" aria-hidden="true" />{tag.found_notice_count} {tag.found_notice_count === 1 ? "person reported finding it" : "reports of it being found"}</p>}
                    <div className="mt-auto flex flex-wrap gap-2">
                      {!tag.is_disabled && tag.status !== "expired" && (
                        tag.status === "lost"
                          ? <button type="button" disabled={switching === tag.tag_id} onClick={() => void setStatus(tag, "active")} className={`${CX.btnGold} min-h-[40px] px-4 text-[13.5px]`}>I found it</button>
                          : <button type="button" disabled={switching === tag.tag_id} onClick={() => void setStatus(tag, "lost")} className={`${CX.btnGhost} min-h-[40px] px-4 text-[13.5px] border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50`}>Mark as lost</button>
                      )}
                      {!tag.is_disabled && tag.status !== "expired" && <button type="button" onClick={() => { setFormError(""); setEditing(tag); }} className={`${CX.btnGhost} min-h-[40px] px-4 text-[13.5px]`}><Pencil size={14} aria-hidden="true" />Edit</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={open} className="rounded-2xl bg-frost-50 p-4" noValidate>
              <label htmlFor="tag-code-input" className="block text-[14px] font-semibold text-ink">Got a new sticker?</label>
              <p className="text-[13px] text-ink-muted">Scan it with your phone camera, or type the code printed on it.</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input id="tag-code-input" value={code} onChange={(e) => { setCode(e.target.value); setCodeError(""); }} placeholder="ABCD EFGH JK23" autoComplete="off" autoCapitalize="characters" spellCheck={false} className={`${CX.input} flex-1 font-mono uppercase tracking-wider`} />
                <button type="submit" disabled={!code.trim()} className={CX.btnNavy}>Register it</button>
              </div>
              {codeError && <p role="alert" className="mt-2 text-[13px] text-rose-700">{codeError}</p>}
            </form>
          </>
        )}
      </div>

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
    </section>
  );
}
