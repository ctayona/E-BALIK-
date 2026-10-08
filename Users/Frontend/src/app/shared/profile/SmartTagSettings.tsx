import { useEffect, useState } from "react";
import { MessageCircle, QrCode, ShieldCheck } from "lucide-react";
import type { Page } from "@/app/types";
import MyTags from "@/app/shared/tags/MyTags";
import { SkeletonBlock } from "@/app/shared/LoadingSkeleton";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { CX } from "@/app/utils/clay";
import { CONTACT_KINDS, TagRequestError, tagsApi, type ContactMethods } from "@/app/utils/tags";

const EMPTY: ContactMethods = { phone2: "", messenger: "", facebook: "", instagram: "", telegram: "", whatsapp: "" };

/**
 * Profile > Smart Tags. Two things live here: the contact methods a finder may be offered (an alternate phone, Messenger, Facebook,
 * Instagram, Telegram, WhatsApp), saved once, and the list of your tags where you choose, tag by tag, what is shown when it is scanned.
 * Nothing is shown to a finder until you switch it on for that tag.
 */
export default function SmartTagSettings({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const [saved, setSaved] = useState<ContactMethods | null>(null);
  const [draft, setDraft] = useState<ContactMethods>(EMPTY);
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    tagsApi.contacts()
      .then((result) => { if (active) { setSaved(result.contacts); setDraft({ ...EMPTY, ...result.contacts }); } })
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof TagRequestError && reason.setupRequired) setSetup(true);
        else setError(reason instanceof Error ? reason.message : "Unable to load your contact methods.");
        setSaved(EMPTY);
      });
    return () => { active = false; };
  }, []);

  const dirty = saved !== null && CONTACT_KINDS.some((method) => (draft[method.kind] ?? "").trim() !== (saved[method.kind] ?? ""));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await tagsApi.saveContacts(draft);
      setSaved(result.contacts);
      setDraft({ ...EMPTY, ...result.contacts });
      showInfoModal({ variant: "success", title: "Contact methods saved", message: "Nothing is shown to a finder until you switch a method on for a tag. Open one of your tags below and choose Edit." });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save your contact methods.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${CX.card} overflow-hidden`} aria-labelledby="profile-tags-heading">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300" aria-hidden="true"><QrCode size={19} /></span>
        <div className="min-w-0">
          <h2 id="profile-tags-heading" className="text-[18px] font-semibold text-ink" style={{ fontFamily: "var(--font-heading)" }}>Smart Tags</h2>
          <p className="mt-0.5 text-[13.5px] leading-6 text-ink-muted">Choose what a finder sees when they scan one of your tags. Everything is hidden until you switch it on.</p>
        </div>
      </header>

      <div className="space-y-6 px-5 py-5 sm:px-6">
        <form onSubmit={save} className="space-y-4" noValidate>
          <div>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink"><MessageCircle size={16} className="text-gold-600" aria-hidden="true" />Ways to reach you</h3>
            <p className={CX.helper}>Save your contact methods once. Then switch them on for each tag. We build the links ourselves from your username, so a finder is only ever sent to the real service.</p>
          </div>
          {saved === null ? (
            <SkeletonBlock className="h-40 w-full rounded-2xl" />
          ) : setup ? (
            <p role="status" className="rounded-2xl border border-gold-300 bg-gold-50 px-4 py-3 text-[14px] leading-6 text-ink-soft">Contact methods switch on after the next database update. Your tags below work as before.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {CONTACT_KINDS.map((method) => (
                <div key={method.kind}>
                  <label htmlFor={`contact-${method.kind}`} className={CX.label}>{method.label}</label>
                  <input
                    id={`contact-${method.kind}`}
                    value={draft[method.kind] ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, [method.kind]: event.target.value }))}
                    inputMode={method.inputMode ?? "text"}
                    maxLength={120}
                    autoComplete="off"
                    placeholder={method.placeholder}
                    className={`${CX.input} w-full`}
                  />
                  <p className={CX.helper}>{method.hint}</p>
                </div>
              ))}
            </div>
          )}
          {error && <p role="alert" className={CX.alertError}>{error}</p>}
          {!setup && saved !== null && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={busy || !dirty} className={`${CX.btnNavy} px-6 py-2.5 text-[14px] disabled:opacity-60`}>{busy ? "Saving…" : "Save contact methods"}</button>
              <p className="flex items-center gap-1.5 text-[13px] text-ink-muted"><ShieldCheck size={14} className="text-tide-600" aria-hidden="true" />Only you can see this list.</p>
            </div>
          )}
        </form>

        <div>
          <h3 className="mb-3 text-[15px] font-semibold text-ink">Your tags: what is shown when scanned</h3>
          <MyTags standalone onRegister={() => onNavigate("my-tags")} />
        </div>
      </div>
    </section>
  );
}
