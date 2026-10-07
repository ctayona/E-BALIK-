import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, BadgeCheck, CalendarX, HandHeart, Hourglass, Lock, Mail, MapPin, Phone, QrCode, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import umakLogo from "@/imports/umaklogo.webp";
import Modal from "@/app/shared/modal/Modal";
import AuthOverlay from "@/app/shared/tags/AuthOverlay";
import TagDetailsForm from "@/app/shared/tags/TagDetailsForm";
import { CX, SPRING } from "@/app/utils/clay";
import { authUtils } from "@/app/utils/api";
import { useCurrentUser } from "@/app/utils/system";
import {
  TagRequestError, extractTagCode, safeMailto, safeTel, spacedCode, tagsApi,
  type FoundResult, type PublicTag, type TagDetailsInput,
} from "@/app/utils/tags";

type Load = { state: "loading" } | { state: "ready"; tag: PublicTag } | { state: "missing" } | { state: "error"; message: string; setup?: boolean };

/** Shell shared by every state of the public scan page. */
function Shell({ code, children }: { code?: string; children: React.ReactNode }) {
  return (
    <main className="app-canvas flex min-h-screen flex-col items-center px-4 pb-10 pt-6 sm:pt-10">
      <header className="mb-5 flex w-full max-w-[560px] items-center gap-3">
        <a href="/" aria-label="E-Balik home" className="flex size-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-line"><img decoding="async" src={umakLogo} alt="" className="size-9 rounded-lg object-cover" /></a>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink">E-Balik Smart Tag</p>
          <p className="text-[12.5px] text-ink-muted">University of Makati · Lost &amp; Found</p>
        </div>
        {code && <span className="rounded-full bg-frost-100 px-3 py-1 font-mono text-[12.5px] tracking-wider text-ink-soft ring-1 ring-line" aria-label={`Tag code ${code}`}>{spacedCode(code)}</span>}
      </header>
      <div className="w-full max-w-[560px] flex-1">{children}</div>
      <footer className="mt-8 max-w-[560px] text-center text-[12.5px] leading-5 text-ink-muted">
        <ShieldCheck size={13} className="mr-1 inline text-tide-600" aria-hidden="true" />Protected by E-Balik. Never share your passwords or verification codes with anyone who contacts you about an item.
      </footer>
    </main>
  );
}

function StateCard({ icon, tone = "navy", title, children }: { icon: React.ReactNode; tone?: "navy" | "gold" | "rose"; title: string; children?: React.ReactNode }) {
  const reduced = useReducedMotion();
  const badge = { navy: "bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300", gold: "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950", rose: "bg-[linear-gradient(145deg,#fda4af,#e11d48)] text-white" }[tone];
  return (
    <motion.section initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="glass relative overflow-hidden rounded-[28px] p-7 text-center sm:p-9">
      <span className="pointer-events-none absolute inset-x-12 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.9),transparent)]" aria-hidden="true" />
      <span className={`mx-auto flex size-[76px] items-center justify-center rounded-[24px] shadow-[0_16px_32px_-14px_rgba(17,27,66,0.8)] ${badge}`} aria-hidden="true">{icon}</span>
      <h1 className="mt-5 font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">{title}</h1>
      {children}
    </motion.section>
  );
}

/** The owner's photo of the item with its sticker. The link is signed and short-lived, and the page is never cached. */
function TagPhoto({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="mt-4 overflow-hidden rounded-2xl border border-line bg-navy-950 shadow-card">
      <img src={url} alt="The item with its Smart Tag sticker attached, photographed by its owner" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} className="max-h-[360px] w-full object-contain" />
      <figcaption className="bg-white/90 px-3.5 py-2 text-[12.5px] text-ink-muted">Photo taken by the owner when the tag was registered. Check that it matches what you are holding.</figcaption>
    </figure>
  );
}

function ContactRow({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string | null }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-line">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-frost-100 text-navy-700" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-ink-muted">{label}</span>
        {href ? <a href={href} className="block break-words text-[15px] font-semibold text-navy-800 underline-offset-2 hover:underline">{value}</a> : <span className="block break-words text-[15px] font-semibold text-ink">{value}</span>}
      </span>
    </li>
  );
}

export default function TagPage({ rawId }: { rawId: string }) {
  const code = extractTagCode(rawId);
  const user = useCurrentUser();
  const signedIn = Boolean(user && authUtils.getToken());
  const reduced = useReducedMotion();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [auth, setAuth] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [foundOpen, setFoundOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [result, setResult] = useState<FoundResult | null>(null);

  // Tag pages name people, so keep them out of search engines.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const previous = document.title;
    document.title = "E-Balik Smart Tag";
    return () => { meta.remove(); document.title = previous; };
  }, []);

  const refresh = useCallback(async () => {
    if (!code) { setLoad({ state: "missing" }); return; }
    try {
      setLoad({ state: "ready", tag: await tagsApi.view(code) });
    } catch (reason) {
      if (reason instanceof TagRequestError && reason.status === 404) setLoad({ state: "missing" });
      else if (reason instanceof TagRequestError) setLoad({ state: "error", message: reason.message, setup: reason.setupRequired });
      else setLoad({ state: "error", message: "This page could not be loaded. Check your connection and try again." });
    }
  }, [code]);

  useEffect(() => { void refresh(); }, [refresh, signedIn]);

  const claim = async (values: TagDetailsInput, consent: boolean, photo: File | null) => {
    if (!code) return;
    if (!photo) { setClaimError("Take a photo of your item with the sticker attached before registering."); return; }
    setClaiming(true);
    setClaimError("");
    try {
      await tagsApi.claim(code, { ...values, dpa_consent: consent }, photo);
      setClaimed(true);
      await refresh();
    } catch (reason) {
      setClaimError(reason instanceof Error ? reason.message : "Unable to register this tag.");
      if (reason instanceof TagRequestError && reason.code === "already_claimed") await refresh();
    } finally {
      setClaiming(false);
    }
  };

  const sendFound = async () => {
    if (!code || sending) return;
    setSending(true);
    setSendError("");
    try {
      setResult(await tagsApi.found(code, { message: message.trim(), contact: contact.trim() }));
    } catch (reason) {
      if (reason instanceof TagRequestError && reason.instructions?.length) setResult({ success: true, notified: false, cooldown: true, instructions: reason.instructions });
      else setSendError(reason instanceof Error ? reason.message : "Unable to notify the owner. Please bring the item to the OHSO guard post anyway.");
    } finally {
      setSending(false);
    }
  };

  const goHome = () => { try { localStorage.setItem("ebalik_user_last_page", "my-tags"); } catch { /* storage blocked: the app opens on its default page */ } window.location.assign("/"); };

  if (load.state === "loading") {
    return <Shell code={code ?? undefined}><div className="glass h-[360px] animate-pulse rounded-[28px]" aria-busy="true" aria-label="Loading Smart Tag" /></Shell>;
  }
  if (load.state === "missing") {
    return (
      <Shell>
        <StateCard icon={<QrCode size={34} />} tone="rose" title="We can't find this tag">
          <p className="mx-auto mt-3 max-w-[40ch] text-[15px] leading-7 text-ink-muted">The code does not match any E-Balik Smart Tag. Check that the whole QR code was scanned, or look for the code printed on the sticker.</p>
          <a href="/" className={`${CX.btnNavy} mt-6`}>Go to E-Balik</a>
        </StateCard>
      </Shell>
    );
  }
  if (load.state === "error") {
    return (
      <Shell code={code ?? undefined}>
        <StateCard icon={<AlertTriangle size={34} />} tone="gold" title={load.setup ? "Smart Tags are opening soon" : "Something went wrong"}>
          <p className="mx-auto mt-3 max-w-[40ch] text-[15px] leading-7 text-ink-muted">{load.setup ? "This feature is being set up. Please try again later." : load.message}</p>
          {!load.setup && <button type="button" onClick={() => { setLoad({ state: "loading" }); void refresh(); }} className={`${CX.btnGold} mt-6`}>Try again</button>}
        </StateCard>
      </Shell>
    );
  }

  const tag = load.tag;
  const tagCode = tag.tag_id;

  // ---- Logic check 1: a blank tag
  if (tag.status === "blank") {
    return (
      <Shell code={tagCode}>
        <StateCard icon={<QrCode size={34} />} tone="gold" title="This E-Balik Smart Tag is unregistered!">
          {signedIn ? (
            <>
              <p className="mx-auto mt-3 max-w-[42ch] text-[15px] leading-7 text-ink-muted">Claim it to link this sticker to your item. If someone finds your item, you will be notified.</p>
              <div className="mt-6 text-left">
                {claimed ? (
                  <p className={CX.alertSuccess} role="status">Submitted. Staff will approve it once they have seen the item…</p>
                ) : (
                  <TagDetailsForm mode="claim" submitLabel="Claim this tag" busy={claiming} error={claimError} onSubmit={(values, consent, photo) => void claim(values, consent, photo)} />
                )}
              </div>
            </>
          ) : (
            <>
              <p className="mx-auto mt-3 max-w-[42ch] text-[15px] leading-7 text-ink-muted">Log in to claim it and link it to your item. It takes a minute, and the sticker is yours once it is registered.</p>
              <motion.button type="button" onClick={() => setAuth(true)} whileHover={reduced ? undefined : { y: -2 }} whileTap={{ scale: 0.98 }} transition={SPRING} className={`${CX.btnGold} mt-6 min-h-[56px] w-full text-[16px]`}>
                <Lock size={18} aria-hidden="true" />Log in to claim it
              </motion.button>
              <p className="mt-3 text-[13px] text-ink-muted">Found a tag that is not yours? Leave it, an unregistered tag does not point to anyone.</p>
            </>
          )}
        </StateCard>
        {auth && <AuthOverlay onClose={() => setAuth(false)} onSignedIn={() => { setAuth(false); void refresh(); }} />}
      </Shell>
    );
  }

  // ---- Expired: the tag's validity period ended, so nothing about the item or owner is shown and nobody can be notified
  if (tag.status === "expired") {
    return (
      <Shell code={tagCode}>
        <StateCard icon={<CalendarX size={34} />} tone="gold" title="This Smart Tag has expired">
          <p className="mx-auto mt-3 max-w-[42ch] text-[15px] leading-7 text-ink-muted">Its validity period has ended, so the owner's details are no longer shown. If you found an item with this sticker, please bring it to the nearest OHSO guard post so it can be checked and returned.</p>
          <p className="mx-auto mt-3 max-w-[42ch] text-[13.5px] leading-6 text-ink-muted">Are you the owner? Ask the Lost and Found Office to renew this tag.</p>
          <a href="/" className={`${CX.btnNavy} mt-6`}>Go to E-Balik</a>
        </StateCard>
      </Shell>
    );
  }

  // ---- Waiting for staff: nothing about the item, owner or photo is shown
  if (tag.status === "pending_verification") {
    return (
      <Shell code={tagCode}>
        <StateCard icon={<Hourglass size={34} />} tone="gold" title={tag.is_owner ? "Your tag is waiting for approval" : "This Smart Tag is awaiting approval"}>
          {tag.is_owner ? (
            <p className="mx-auto mt-3 max-w-[42ch] text-[15px] leading-7 text-ink-muted">Bring the item with this sticker on it to the Lost and Found Office. Staff will compare it with the photo you took, then switch the tag on. Until then nobody can see your details.</p>
          ) : (
            <p className="mx-auto mt-3 max-w-[42ch] text-[15px] leading-7 text-ink-muted">This sticker has not been verified by the university yet, so no details are shown. If you found an item with this sticker, please bring it to the nearest OHSO guard post so it can be checked and returned.</p>
          )}
          <a href="/" className={`${CX.btnNavy} mt-6`}>Go to E-Balik</a>
        </StateCard>
      </Shell>
    );
  }

  // ---- Deactivated, or the owner's account is gone: nothing about the item or owner is shown
  if (tag.status === "disabled" || tag.status === "inactive") {
    return (
      <Shell code={tagCode}>
        <StateCard icon={<ShieldAlert size={34} />} tone="rose" title={tag.status === "disabled" ? "This Smart Tag was deactivated" : "This Smart Tag is no longer active"}>
          <p className="mx-auto mt-3 max-w-[42ch] text-[15px] leading-7 text-ink-muted">If you found an item with this sticker, please bring it to the nearest OHSO guard post so it can be checked and returned.</p>
          <a href="/" className={`${CX.btnNavy} mt-6`}>Go to E-Balik</a>
        </StateCard>
      </Shell>
    );
  }

  // ---- Logic check 2: an active or lost tag
  const lost = tag.status === "lost";
  const contactInfo = tag.contact ?? {};
  const hasContact = Boolean(contactInfo.name || contactInfo.email || contactInfo.phone);

  return (
    <Shell code={tagCode}>
      <motion.section initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="glass relative overflow-hidden rounded-[28px]">
        <span className="pointer-events-none absolute inset-x-12 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.9),transparent)]" aria-hidden="true" />
        {lost && (
          <p className="flex items-center justify-center gap-2 bg-[linear-gradient(90deg,#e11d48,#be123c)] px-4 py-2.5 text-center text-[14px] font-semibold text-white" role="status">
            <AlertTriangle size={16} aria-hidden="true" />The owner marked this item as LOST
          </p>
        )}
        <div className="p-6 sm:p-8">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-gold-700"><BadgeCheck size={15} aria-hidden="true" />Registered Smart Tag</p>
          <h1 className="mt-1.5 break-words font-[family-name:var(--font-heading)] text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">{tag.item_name}</h1>
          {tag.photo_url && <TagPhoto url={tag.photo_url} />}
          {tag.item_description && <p className="mt-3 whitespace-pre-line break-words text-[15px] leading-7 text-ink-soft">{tag.item_description}</p>}

          {tag.is_owner && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-gold-300 bg-gold-50 p-4">
              <p className="min-w-0 flex-1 text-[14px] leading-6 text-ink-soft"><UserRound size={15} className="mr-1.5 inline text-gold-700" aria-hidden="true" />This is your tag. Finders see what is shown on this page.</p>
              <button type="button" onClick={goHome} className={CX.btnNavy}>Manage my tags<ArrowRight size={15} aria-hidden="true" /></button>
            </div>
          )}

          <div className="mt-6">
            <h2 className="text-[13px] font-semibold text-ink-muted">Owner contact (shared by the owner)</h2>
            {hasContact ? (
              <ul className="mt-2 space-y-2">
                {contactInfo.name && <ContactRow icon={<UserRound size={17} />} label="Name" value={contactInfo.name} />}
                {contactInfo.email && <ContactRow icon={<Mail size={17} />} label="Email" value={contactInfo.email} href={safeMailto(contactInfo.email)} />}
                {contactInfo.phone && <ContactRow icon={<Phone size={17} />} label="Phone" value={contactInfo.phone} href={safeTel(contactInfo.phone)} />}
              </ul>
            ) : (
              <p className="mt-2 rounded-2xl border border-dashed border-line-strong px-4 py-4 text-[14px] leading-6 text-ink-muted">The owner keeps their details private. Press the button below and E-Balik will notify them for you.</p>
            )}
          </div>

          <motion.button
            type="button"
            onClick={() => { setResult(null); setSendError(""); setFoundOpen(true); }}
            whileHover={reduced ? undefined : { y: -3, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            transition={SPRING}
            className={`${CX.btnGold} mt-7 min-h-[78px] w-full gap-3 rounded-[20px] text-[22px] font-bold shadow-[0_18px_40px_-16px_rgba(209,161,83,0.95)] sm:text-[24px]`}
          >
            <HandHeart size={28} aria-hidden="true" />I found this item!
          </motion.button>
          <p className="mt-3 text-center text-[13px] leading-5 text-ink-muted">We will notify the owner right away and tell you where to take it.</p>
        </div>
      </motion.section>

      <Modal
        open={foundOpen}
        onClose={() => { if (!sending) setFoundOpen(false); }}
        dismissible={!sending}
        size="md"
        tone={result ? "mint" : "gold"}
        icon={result ? <ShieldCheck size={21} /> : <HandHeart size={21} />}
        eyebrow={result ? "Thank you" : "Return this item"}
        title={result ? (result.notified ? "The owner has been notified" : result.cooldown ? "The owner was already notified" : "Next steps") : "Tell the owner you found it"}
        description={result ? "Please follow these steps so the item gets back safely." : "Your message is optional. We will not show your details to anyone except the owner."}
        footer={result ? (
          <button type="button" onClick={() => setFoundOpen(false)} className={CX.btnNavy}>Done</button>
        ) : (
          <>
            <button type="button" onClick={() => setFoundOpen(false)} disabled={sending} className={CX.btnGhost}>Cancel</button>
            <button type="button" onClick={() => void sendFound()} disabled={sending} className={CX.btnGold}>{sending ? "Notifying…" : "Notify the owner"}</button>
          </>
        )}
      >
        {result ? (
          <div className="space-y-4">
            {result.cooldown && !result.notified && <p className={CX.alertInfo}>The owner was told a moment ago, so we did not send another alert. The steps below still apply.</p>}
            <ol className="space-y-3">
              {result.instructions.map((line, index) => (
                <li key={line} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-800 text-[13px] font-bold text-white" aria-hidden="true">{index + 1}</span>
                  <span className="pt-0.5 text-[15px] leading-6 text-ink-soft">{line}</span>
                </li>
              ))}
            </ol>
            <p className="flex items-center gap-2 rounded-2xl bg-frost-100 px-4 py-3 text-[14px] text-ink-soft"><MapPin size={16} className="shrink-0 text-gold-700" aria-hidden="true" />Tag code to tell the guard: <span className="font-mono font-semibold tracking-wider text-ink">{spacedCode(tagCode)}</span></p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="found-message" className={CX.label}>Message to the owner <span className="font-normal text-ink-muted">(optional)</span></label>
              <textarea id="found-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} rows={3} placeholder="Where and when you found it" className={`${CX.input} w-full resize-y py-3 leading-6`} data-autofocus />
            </div>
            <div>
              <label htmlFor="found-contact" className={CX.label}>How can the owner reach you? <span className="font-normal text-ink-muted">(optional)</span></label>
              <input id="found-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} placeholder="Name or phone number" autoComplete="off" className={`${CX.input} w-full`} />
              <p className={CX.helper}>Only the owner sees this. To stay safe, hand the item to the guard post instead of meeting alone.</p>
            </div>
            {sendError && <p role="alert" className={CX.alertError}>{sendError}</p>}
          </div>
        )}
      </Modal>
    </Shell>
  );
}
