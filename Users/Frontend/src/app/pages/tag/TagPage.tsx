import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, BadgeCheck, CalendarX, HandHeart, Hourglass, Lock, LogIn, MapPin, PackagePlus, QrCode, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import umakLogo from "@/imports/umaklogo.webp";
import Modal from "@/app/shared/modal/Modal";
import AuthOverlay from "@/app/shared/tags/AuthOverlay";
import TagDetailsForm from "@/app/shared/tags/TagDetailsForm";
import { ContactIcon } from "@/app/shared/tags/contactIcons";
import { CX, SPRING } from "@/app/utils/clay";
import { authUtils } from "@/app/utils/api";
import { useCurrentUser } from "@/app/utils/system";
import {
  TagRequestError, extractTagCode, safeLink, safeMailto, safeTel, spacedCode, tagsApi,
  type FoundResult, type PublicTag, type TagDetailsInput,
} from "@/app/utils/tags";

type Load = { state: "loading" } | { state: "ready"; tag: PublicTag } | { state: "missing" } | { state: "error"; message: string; setup?: boolean };

/** Words on the finder's view, in the language the owner chose for their tag page. Everything else on this page is English. */
const WORDS = {
  en: {
    registered: "Registered Smart Tag", active: "Active", lost: "Lost", lostBanner: "The owner marked this item as LOST",
    belongsTo: "This item belongs to", member: "A verified UMak member", ownerContact: "Reach the owner",
    private: "The owner keeps their details private. Press the button below and E-Balik will notify them for you.",
    call: "Call", email: "Email", message: "Message", found: "I found this item", foundNote: "We notify the owner right away and tell you where to take it.",
    photo: "Photo taken by the owner when the tag was registered. Check that it matches what you are holding.",
    yours: "This is your tag. Finders see what is shown on this page.", manage: "Manage my tags",
    safety: "Never share your passwords or verification codes with anyone who contacts you about an item.",
    modalTitle: "Tell the owner you found it", modalEyebrow: "Return this item", modalDescription: "Your message is optional. We will not show your details to anyone except the owner.",
    messageLabel: "Message to the owner", contactLabel: "How can the owner reach you?", optional: "(optional)",
    messagePlaceholder: "Where and when you found it", contactPlaceholder: "Name or phone number",
    contactHint: "Only the owner sees this. To stay safe, hand the item to the guard post instead of meeting alone.",
    cancel: "Cancel", notify: "Notify the owner", notifying: "Notifying…",
  },
  fil: {
    registered: "Rehistradong Smart Tag", active: "Aktibo", lost: "Nawawala", lostBanner: "Minarkahan ito ng may-ari bilang NAWAWALA",
    belongsTo: "Ang gamit na ito ay pag-aari ni", member: "Isang beripikadong miyembro ng UMak", ownerContact: "Makipag-ugnayan sa may-ari",
    private: "Pribado ang mga detalye ng may-ari. Pindutin ang button sa ibaba at aabisuhan namin siya para sa iyo.",
    call: "Tumawag", email: "Mag-email", message: "Mag-message", found: "Nahanap ko ang gamit na ito", foundNote: "Aabisuhan namin agad ang may-ari at sasabihin namin kung saan ito dadalhin.",
    photo: "Kuha ng may-ari noong inirehistro ang tag. Tingnan kung tugma ito sa hawak mo.",
    yours: "Ito ang tag mo. Ito ang nakikita ng nakahanap.", manage: "Pamahalaan ang mga tag ko",
    safety: "Huwag ibigay ang iyong password o verification code sa sinumang kumontak sa iyo tungkol sa isang gamit.",
    modalTitle: "Sabihin sa may-ari na nahanap mo ito", modalEyebrow: "Ibalik ang gamit", modalDescription: "Hindi kailangan ang mensahe. Ang may-ari lang ang makakakita ng mga detalye mo.",
    messageLabel: "Mensahe sa may-ari", contactLabel: "Paano ka makokontak ng may-ari?", optional: "(hindi kailangan)",
    messagePlaceholder: "Saan at kailan mo ito nahanap", contactPlaceholder: "Pangalan o numero ng telepono",
    contactHint: "Ang may-ari lang ang makakakita nito. Para ligtas, iabot ang gamit sa guard post sa halip na makipagkita nang mag-isa.",
    cancel: "Kanselahin", notify: "Abisuhan ang may-ari", notifying: "Inaabisuhan…",
  },
};
type Words = (typeof WORDS)["en"];

/** Full-screen night shell for every state of the public scan page. No app header or menu: this page is for strangers. */
function Shell({ code, children, safety = WORDS.en.safety }: { code?: string; children: React.ReactNode; safety?: string }) {
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center overflow-hidden bg-[linear-gradient(170deg,#0e1830_0%,#162448_45%,#1f3160_100%)] px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-white sm:justify-center sm:py-10">
      <span className="pointer-events-none absolute -top-40 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-gold-500/15 blur-3xl" aria-hidden="true" />
      <span className="pointer-events-none absolute -bottom-48 -right-32 size-[420px] rounded-full bg-iris-500/15 blur-3xl" aria-hidden="true" />
      <div className="relative w-full max-w-md">{children}</div>
      <footer className="relative mt-8 max-w-md text-center text-[12.5px] leading-5 text-white/55">
        {code && <p className="mb-2 font-mono text-[12.5px] tracking-[0.18em] text-white/70" aria-label={`Tag code ${code}`}>{spacedCode(code)}</p>}
        <p><ShieldCheck size={13} className="mr-1 inline text-gold-300" aria-hidden="true" />{safety}</p>
        <p className="mt-3 font-semibold text-white/70">Powered by E-Balik · University of Makati</p>
      </footer>
    </main>
  );
}

/** The glass card at the centre of the page, with the logo and the Smart Tag badge on top. Slides up when it appears. */
function Card({ children, banner }: { children: React.ReactNode; banner?: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 36, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 28 }}
      className="relative overflow-hidden rounded-[30px] bg-white/10 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)] ring-1 ring-white/15 backdrop-blur-2xl"
    >
      <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.95),transparent)]" aria-hidden="true" />
      {banner}
      <div className="px-6 pb-7 pt-6 sm:px-8">
        <div className="flex items-center justify-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20"><img decoding="async" src={umakLogo} alt="" className="size-8 rounded-lg object-cover" /></span>
          <span className="font-[family-name:var(--font-heading)] text-[17px] font-semibold tracking-[-0.01em]">E-Balik</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gold-500/15 px-2.5 py-1 text-[12px] font-semibold text-gold-200 ring-1 ring-gold-400/40"><QrCode size={12} aria-hidden="true" />Smart Tag</span>
        </div>
        {children}
      </div>
    </motion.section>
  );
}

function StateCard({ icon, tone = "navy", title, children }: { icon: React.ReactNode; tone?: "navy" | "gold" | "rose"; title: string; children?: React.ReactNode }) {
  const badge = { navy: "bg-[linear-gradient(145deg,#33497f,#1f3160)] text-gold-300 ring-1 ring-white/15", gold: "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950", rose: "bg-[linear-gradient(145deg,#fda4af,#e11d48)] text-white" }[tone];
  return (
    <Card>
      <div className="mt-7 text-center">
        <span className={`mx-auto flex size-[72px] items-center justify-center rounded-[22px] shadow-[0_16px_32px_-14px_rgba(0,0,0,0.8)] ${badge}`} aria-hidden="true">{icon}</span>
        <h1 className="mt-5 font-[family-name:var(--font-heading)] text-[25px] font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">{title}</h1>
        {children}
      </div>
    </Card>
  );
}

const muted = "mx-auto mt-3 max-w-[42ch] text-[15px] leading-7 text-white/70";
const homeButton = "mt-6 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-white/10 px-6 text-[15px] font-semibold text-white ring-1 ring-white/20 transition-colors hover:bg-white/15";

/** The owner's photo of the item with its sticker. The link is signed and short-lived, and the page is never cached. */
function TagPhoto({ url, caption }: { url: string; caption: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="mt-5 overflow-hidden rounded-2xl bg-navy-950 ring-1 ring-white/15">
      <img src={url} alt="The item with its Smart Tag sticker attached, photographed by its owner" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} className="max-h-[300px] w-full object-contain" />
      <figcaption className="bg-black/30 px-3.5 py-2 text-[12px] leading-5 text-white/65">{caption}</figcaption>
    </figure>
  );
}

type Pill = { key: string; kind: string; label: string; sub: string; href: string };

/** The ways to reach the owner, as big pill buttons. Only what the owner switched on is ever present, and only safe links are built. */
function contactPills(tag: PublicTag, words: Words): Pill[] {
  const info = tag.contact ?? {};
  const pills: Pill[] = [];
  const tel = info.phone ? safeTel(info.phone) : null;
  if (tel && info.phone) pills.push({ key: "phone", kind: "phone2", label: words.call, sub: info.phone, href: tel });
  const mail = info.email ? safeMailto(info.email) : null;
  if (mail && info.email) pills.push({ key: "account-email", kind: "email", label: words.email, sub: info.email, href: mail });
  const order = ["phone2", "email", "messenger", "whatsapp", "telegram", "facebook", "twitter", "instagram"];
  [...(info.links ?? [])].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).forEach((link) => {
    const href = safeLink(link.url);
    if (!href) return;
    const label = link.kind === "phone2" ? words.call : link.kind === "email" ? words.email : link.kind === "messenger" ? words.message : link.kind === "twitter" ? "X" : link.label;
    const sub = href.startsWith("tel:") ? href.slice(4) : href.startsWith("mailto:") ? href.slice(7) : link.kind === "messenger" ? "Messenger" : href.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "");
    pills.push({ key: link.kind, kind: link.kind, label, sub, href });
  });
  return pills;
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

  /** Open the app on a given page (the app reads the last page on start). */
  const openApp = (page: "my-tags" | "found-item") => {
    try {
      localStorage.setItem("ebalik_user_last_page", page);
      if (page === "found-item") sessionStorage.setItem("ebalik_user_navigation_options", JSON.stringify({ mode: "form" }));
    } catch { /* storage blocked: the app opens on its default page */ }
    window.location.assign("/");
  };

  if (load.state === "loading") {
    return <Shell code={code ?? undefined}><div className="h-[420px] animate-pulse rounded-[30px] bg-white/10 ring-1 ring-white/10" aria-busy="true" aria-label="Loading Smart Tag" /></Shell>;
  }
  if (load.state === "missing") {
    return (
      <Shell>
        <StateCard icon={<QrCode size={32} />} tone="rose" title="We can't find this tag">
          <p className={muted}>The code does not match any E-Balik Smart Tag. Check that the whole QR code was scanned, or look for the code printed on the sticker.</p>
          <a href="/" className={homeButton}>Go to E-Balik</a>
        </StateCard>
      </Shell>
    );
  }
  if (load.state === "error") {
    return (
      <Shell code={code ?? undefined}>
        <StateCard icon={<AlertTriangle size={32} />} tone="gold" title={load.setup ? "Smart Tags are opening soon" : "Something went wrong"}>
          <p className={muted}>{load.setup ? "This feature is being set up. Please try again later." : load.message}</p>
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
        <StateCard icon={<QrCode size={32} />} tone="gold" title="This E-Balik Smart Tag is unregistered!">
          {signedIn ? (
            <>
              <p className={muted}>Claim it to link this sticker to your item. If someone finds your item, you will be notified.</p>
              <div className="mt-6 rounded-2xl bg-white p-4 text-left text-ink shadow-card sm:p-5">
                {claimed ? (
                  <p className={CX.alertSuccess} role="status">Submitted. Staff will approve it once they have seen the item…</p>
                ) : (
                  <TagDetailsForm mode="claim" submitLabel="Claim this tag" busy={claiming} error={claimError} onSubmit={(values, consent, photo) => void claim(values, consent, photo)} />
                )}
              </div>
            </>
          ) : (
            <>
              <p className={muted}>Log in to claim it and link it to your item. It takes a minute, and the sticker is yours once it is registered.</p>
              <motion.button type="button" onClick={() => setAuth(true)} whileHover={reduced ? undefined : { y: -2 }} whileTap={{ scale: 0.98 }} transition={SPRING} className={`${CX.btnGold} mt-6 min-h-[56px] w-full text-[16px]`}>
                <Lock size={18} aria-hidden="true" />Log in to claim it
              </motion.button>
              <p className="mt-3 text-[13px] text-white/60">Found a tag that is not yours? Leave it, an unregistered tag does not point to anyone.</p>
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
        <StateCard icon={<CalendarX size={32} />} tone="gold" title="This Smart Tag has expired">
          <p className={muted}>Its validity period has ended, so the owner's details are no longer shown. If you found an item with this sticker, please bring it to the nearest OHSO guard post so it can be checked and returned.</p>
          <p className="mx-auto mt-3 max-w-[42ch] text-[13.5px] leading-6 text-white/60">Are you the owner? Ask the Lost and Found Office to renew this tag.</p>
          <a href="/" className={homeButton}>Go to E-Balik</a>
        </StateCard>
      </Shell>
    );
  }

  // ---- Waiting for staff: nothing about the item, owner or photo is shown
  if (tag.status === "pending_verification") {
    return (
      <Shell code={tagCode}>
        <StateCard icon={<Hourglass size={32} />} tone="gold" title={tag.is_owner ? "Your tag is waiting for approval" : "This Smart Tag is awaiting approval"}>
          <p className={muted}>{tag.is_owner
            ? "Bring the item with this sticker on it to the Lost and Found Office. Staff will compare it with the photo you took, then switch the tag on. Until then nobody can see your details."
            : "This sticker has not been verified by the university yet, so no details are shown. If you found an item with this sticker, please bring it to the nearest OHSO guard post so it can be checked and returned."}</p>
          <a href="/" className={homeButton}>Go to E-Balik</a>
        </StateCard>
      </Shell>
    );
  }

  // ---- Deactivated, or the owner's account is gone: nothing about the item or owner is shown
  if (tag.status === "disabled" || tag.status === "inactive") {
    return (
      <Shell code={tagCode}>
        <StateCard icon={<ShieldAlert size={32} />} tone="rose" title={tag.status === "disabled" ? "This Smart Tag was deactivated" : "This Smart Tag is no longer active"}>
          <p className={muted}>If you found an item with this sticker, please bring it to the nearest OHSO guard post so it can be checked and returned.</p>
          <a href="/" className={homeButton}>Go to E-Balik</a>
        </StateCard>
      </Shell>
    );
  }

  // ---- Logic check 2: an active or lost tag
  const words: Words = WORDS[tag.language === "fil" ? "fil" : "en"];
  const lost = tag.status === "lost";
  const name = tag.contact?.name;
  const pills = contactPills(tag, words);
  const monogram = name ? name.split(/\s+/).map((part) => part.replace(/[^\p{L}]/gu, "")[0] ?? "").join("").slice(0, 2).toUpperCase() : "";

  return (
    <Shell code={tagCode} safety={words.safety}>
      <Card banner={lost ? (
        <p className="flex items-center justify-center gap-2 bg-[linear-gradient(90deg,#e11d48,#be123c)] px-4 py-2.5 text-center text-[14px] font-semibold text-white" role="status">
          <AlertTriangle size={16} aria-hidden="true" />{words.lostBanner}
        </p>
      ) : undefined}>
        <div className="mt-6 flex flex-col items-center text-center">
          <span className="relative">
            <span className="absolute -inset-1.5 rounded-full bg-[conic-gradient(from_140deg,#f3dcab,#d1a153,#8a6526,#f3dcab)] opacity-90" aria-hidden="true" />
            <span className="relative flex size-[84px] items-center justify-center rounded-full bg-[linear-gradient(160deg,#33497f_0%,#1f3160_70%)] text-[26px] font-bold text-gold-200 ring-4 ring-[#162448]" aria-hidden="true">
              {monogram || <UserRound size={34} />}
            </span>
          </span>
          <p className="mt-4 text-[13px] font-medium text-white/60">{words.belongsTo}</p>
          <p className="mt-0.5 font-[family-name:var(--font-heading)] text-[19px] font-semibold">{name || words.member}</p>
          <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold ring-1 ${lost ? "bg-rose-500/20 text-rose-100 ring-rose-300/40" : "bg-tide-500/15 text-tide-100 ring-tide-300/40"}`}>
            <span className={`size-1.5 rounded-full ${lost ? "animate-pulse bg-rose-300" : "bg-tide-300"}`} aria-hidden="true" />{lost ? words.lost : words.active}
          </span>
        </div>

        <div className="mt-6 rounded-2xl bg-black/20 p-4 ring-1 ring-white/10">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-gold-300"><BadgeCheck size={14} aria-hidden="true" />{words.registered}</p>
          <h1 className="mt-1 break-words font-[family-name:var(--font-heading)] text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[26px]">{tag.item_name}</h1>
          {tag.item_description && <p className="mt-2 whitespace-pre-line break-words text-[14.5px] leading-6 text-white/75">{tag.item_description}</p>}
          {tag.photo_url && <TagPhoto url={tag.photo_url} caption={words.photo} />}
        </div>

        {tag.is_owner && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-gold-500/10 p-4 ring-1 ring-gold-400/40">
            <p className="min-w-0 flex-1 text-[13.5px] leading-6 text-white/80"><UserRound size={15} className="mr-1.5 inline text-gold-300" aria-hidden="true" />{words.yours}</p>
            <button type="button" onClick={() => openApp("my-tags")} className={`${CX.btnGold} min-h-[44px]`}>{words.manage}<ArrowRight size={15} aria-hidden="true" /></button>
          </div>
        )}

        <div className="mt-6">
          <h2 className="text-[13px] font-semibold text-white/60">{words.ownerContact}</h2>
          {pills.length ? (
            <motion.ul
              className="mt-2.5 grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2"
              initial={reduced ? false : "hidden"}
              animate="shown"
              variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.07, delayChildren: 0.25 } } }}
            >
              {pills.map((pill) => (
                <motion.li key={pill.key} variants={{ hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } }} transition={{ type: "spring", stiffness: 380, damping: 30 }}>
                  <a
                    href={pill.href}
                    target={pill.href.startsWith("https://") ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className="group flex min-h-[60px] items-center gap-3 rounded-2xl bg-white/10 px-3.5 py-2.5 ring-1 ring-white/15 transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-white/15 hover:shadow-[0_0_0_1px_rgba(209,161,83,0.6),0_14px_30px_-16px_rgba(209,161,83,0.8)] active:scale-[0.98]"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950"><ContactIcon kind={pill.kind} size={18} /></span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold leading-5">{pill.label}</span>
                      <span className="block truncate text-[12px] text-white/60">{pill.sub}</span>
                    </span>
                  </a>
                </motion.li>
              ))}
            </motion.ul>
          ) : (
            <p className="mt-2 rounded-2xl border border-dashed border-white/20 px-4 py-4 text-[14px] leading-6 text-white/70">{words.private}</p>
          )}
        </div>

        <motion.button
          type="button"
          onClick={() => { setResult(null); setSendError(""); setFoundOpen(true); }}
          whileHover={reduced ? undefined : { y: -3, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          transition={SPRING}
          className={`${CX.btnGold} mt-7 min-h-[68px] w-full gap-3 rounded-[20px] text-[19px] font-bold shadow-[0_18px_40px_-16px_rgba(209,161,83,0.95)] sm:text-[20px]`}
        >
          <HandHeart size={26} aria-hidden="true" />{words.found}
        </motion.button>
        <p className="mt-3 text-center text-[13px] leading-5 text-white/60">{words.foundNote}</p>
      </Card>

      <Modal
        open={foundOpen}
        onClose={() => { if (!sending) setFoundOpen(false); }}
        dismissible={!sending}
        size="md"
        tone={result ? "mint" : "gold"}
        icon={result ? <ShieldCheck size={21} /> : <HandHeart size={21} />}
        eyebrow={result ? "Thank you" : words.modalEyebrow}
        title={result ? (result.notified ? "The owner has been notified" : result.cooldown ? "The owner was already notified" : "Next steps") : words.modalTitle}
        description={result ? "Please follow these steps so the item gets back safely." : words.modalDescription}
        footer={result ? (
          <>
            <button type="button" onClick={() => setFoundOpen(false)} className={CX.btnGhost}>Done</button>
            {signedIn
              ? <button type="button" onClick={() => openApp("found-item")} className={CX.btnNavy}><PackagePlus size={16} aria-hidden="true" />File a found report</button>
              : <a href="/" className={CX.btnNavy}><LogIn size={16} aria-hidden="true" />Log in or register</a>}
          </>
        ) : (
          <>
            <button type="button" onClick={() => setFoundOpen(false)} disabled={sending} className={CX.btnGhost}>{words.cancel}</button>
            <button type="button" onClick={() => void sendFound()} disabled={sending} className={CX.btnGold}>{sending ? words.notifying : words.notify}</button>
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
            <p className="flex items-center gap-2 rounded-2xl bg-frost-100 px-4 py-3 text-[14px] text-ink-soft"><MapPin size={16} className="shrink-0 text-gold-700" aria-hidden="true" />Tag code to tell the guard: <span className="font-mono font-semibold tracking-wide text-ink">{spacedCode(tagCode)}</span></p>
            <p className="text-[13px] leading-5 text-ink-muted">{signedIn ? "You can also file a found report, so the item shows up for its owner in E-Balik." : "With an E-Balik account you can file a found report and follow what happens to the item."}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="found-message" className={CX.label}>{words.messageLabel} <span className="font-normal text-ink-muted">{words.optional}</span></label>
              <textarea id="found-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} rows={3} placeholder={words.messagePlaceholder} className={`${CX.input} w-full resize-y py-3 leading-6`} data-autofocus />
            </div>
            <div>
              <label htmlFor="found-contact" className={CX.label}>{words.contactLabel} <span className="font-normal text-ink-muted">{words.optional}</span></label>
              <input id="found-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} placeholder={words.contactPlaceholder} autoComplete="off" className={`${CX.input} w-full`} />
              <p className={CX.helper}>{words.contactHint}</p>
            </div>
            {sendError && <p role="alert" className={CX.alertError}>{sendError}</p>}
          </div>
        )}
      </Modal>
    </Shell>
  );
}
