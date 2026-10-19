import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowRight, BellRing, ChevronDown, Eye, Languages, Monitor, Moon, QrCode, Radio, ShieldCheck, Sun, UserRound, Volume2 } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import { SkeletonBlock } from "@/app/shared/LoadingSkeleton";
import { showToast } from "@/app/shared/toast/toastStore";
import { ContactIcon } from "@/app/shared/tags/contactIcons";
import { CX } from "@/app/utils/clay";
import { useCurrentUser } from "@/app/utils/system";
import { playNotificationChime, useNotificationSound } from "@/app/utils/notificationSound";
import { useThemePreference, type ThemePreference } from "@/app/utils/theme";
import {
  CONTACT_KINDS, DEFAULT_TAG_SETTINGS, TagRequestError, tagsApi,
  type ContactKind, type ContactMethods, type TagSettings,
} from "@/app/utils/tags";

const EMPTY = Object.fromEntries(CONTACT_KINDS.map((method) => [method.kind, ""])) as ContactMethods;

/** Quick checks so most typing mistakes are caught before the request. The server checks everything again. */
function localProblem(kind: ContactKind, value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (kind === "email" && !/^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(text.replace(/^mailto:/i, ""))) return "Enter a valid email address, for example name@umak.edu.ph.";
  if (kind === "twitter" && !/^(@?[A-Za-z0-9_]{1,15}|(https?:\/\/)?(www\.|mobile\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}[/?#]?.*)$/.test(text)) return "Type your X handle (up to 15 letters, numbers or _), or paste your x.com link.";
  return "";
}

function initials(name: string) {
  return name.split(/\s+/).filter((part) => /^\p{L}/u.test(part)).map((part) => `${part[0].toUpperCase()}.`).join(" ");
}

/** A row of mutually exclusive choices (name display, language, theme). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; icon?: React.ReactNode }>; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-frost-100 p-1 ring-1 ring-line">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2 text-[13.5px] font-semibold transition-[background-color,color,box-shadow] ${
            value === option.value ? "bg-[linear-gradient(180deg,#2b4282_0%,#1f3160_100%)] text-white shadow-[0_6px_14px_-8px_rgba(31,49,96,0.9)]" : "text-ink-soft hover:bg-white/80"
          }`}
        >
          {option.icon}{option.label}
        </button>
      ))}
    </div>
  );
}

export function SwitchRow({ checked, onChange, label, hint, icon, action }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint: string; icon: React.ReactNode; action?: React.ReactNode }) {
  const id = useId();
  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-3.5 transition-colors ${checked ? "border-gold-300 bg-gold-50" : "border-line bg-white/80"}`}>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${checked ? "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" : "bg-frost-100 text-ink-muted"}`} aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer text-[14.5px] font-semibold text-ink">{label}</label>
        <span className="block text-[12.5px] leading-5 text-ink-muted">{hint}</span>
      </span>
      {action}
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-gold-500" : "bg-slate-300"}`}>
        <span className={`absolute left-0.5 top-0.5 size-6 rounded-full bg-[#ffffff] shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

export function Section({ title, icon, children, note }: { title: string; icon: React.ReactNode; children: React.ReactNode; note?: string }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink"><span className="text-gold-700" aria-hidden="true">{icon}</span>{title}</h3>
        {note && <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Smart Tag contact settings and the preferences that go with them, in one window opened from the Profile.
 * Server-side: the contact methods (phone, email, Facebook, Messenger, X, and the older Instagram, Telegram, WhatsApp), how the name
 * appears to finders, and the language of the scan page. On this device: the notification sound and the theme, which apply at once.
 * Nothing is shown to a finder until the owner switches a method on for a tag (in the tag's Edit form).
 */
export default function SmartTagContactModal({ open, onClose, onSaved, onManageTags }: {
  open: boolean;
  onClose: () => void;
  onSaved?: (contacts: ContactMethods, settings: TagSettings) => void;
  onManageTags?: () => void;
}) {
  const user = useCurrentUser();
  const fullName = `${user?.fname ?? ""} ${user?.lname ?? ""}`.replace(/\s+/g, " ").trim() || "Your name";
  const [saved, setSaved] = useState<ContactMethods | null>(null);
  const [savedSettings, setSavedSettings] = useState<TagSettings>(DEFAULT_TAG_SETTINGS);
  const [draft, setDraft] = useState<ContactMethods>(EMPTY);
  const [settings, setSettings] = useState<TagSettings>(DEFAULT_TAG_SETTINGS);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sound, setSound] = useNotificationSound();
  const [themePreference, setThemePreference] = useThemePreference();

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await tagsApi.contacts();
      const loadedSettings = { ...DEFAULT_TAG_SETTINGS, ...(result.settings ?? {}) };
      setSaved({ ...EMPTY, ...result.contacts });
      setDraft({ ...EMPTY, ...result.contacts });
      setSavedSettings(loadedSettings);
      setSettings(loadedSettings);
      setMoreOpen(CONTACT_KINDS.some((method) => !method.main && result.contacts[method.kind]));
    } catch (reason) {
      if (reason instanceof TagRequestError && reason.setupRequired) setSetup(true);
      else setError(reason instanceof Error ? reason.message : "Unable to load your contact settings.");
      setSaved(EMPTY);
    }
  }, []);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const problems = useMemo(() => Object.fromEntries(CONTACT_KINDS.map((method) => [method.kind, localProblem(method.kind, draft[method.kind] ?? "")])) as Record<ContactKind, string>, [draft]);
  const firstProblem = CONTACT_KINDS.find((method) => problems[method.kind]);
  const dirty = saved !== null && (
    CONTACT_KINDS.some((method) => (draft[method.kind] ?? "").trim() !== (saved[method.kind] ?? ""))
    || settings.name_display !== savedSettings.name_display || settings.language !== savedSettings.language
  );

  const save = async () => {
    if (busy || !saved) return;
    if (firstProblem) { setError(problems[firstProblem.kind]); return; }
    setBusy(true);
    setError("");
    // Optimistic: the Profile card shows the new choices at once; they are put back if the server refuses.
    const before = { contacts: saved, settings: savedSettings };
    const trimmed = Object.fromEntries(CONTACT_KINDS.map((method) => [method.kind, (draft[method.kind] ?? "").trim()])) as ContactMethods;
    onSaved?.(trimmed, settings);
    try {
      const result = await tagsApi.saveContacts(trimmed, settings);
      const nextSettings = { ...DEFAULT_TAG_SETTINGS, ...(result.settings ?? settings) };
      setSaved({ ...EMPTY, ...result.contacts });
      setDraft({ ...EMPTY, ...result.contacts });
      setSavedSettings(nextSettings);
      setSettings(nextSettings);
      onSaved?.({ ...EMPTY, ...result.contacts }, nextSettings);
      showToast("Smart Tag settings saved");
      onClose();
    } catch (reason) {
      onSaved?.(before.contacts, before.settings);
      setError(reason instanceof Error ? reason.message : "Unable to save your settings.");
    } finally {
      setBusy(false);
    }
  };

  const shownName = settings.name_display === "initials" ? initials(fullName) || "Initials" : fullName;
  const filled = CONTACT_KINDS.filter((method) => (draft[method.kind] ?? "").trim());

  const field = (method: (typeof CONTACT_KINDS)[number]) => {
    const problem = problems[method.kind];
    return (
      <div key={method.kind}>
        <label htmlFor={`tag-contact-${method.kind}`} className={CX.label}>{method.label}</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"><ContactIcon kind={method.kind} size={17} /></span>
          <input
            id={`tag-contact-${method.kind}`}
            value={draft[method.kind] ?? ""}
            onChange={(event) => { setDraft((current) => ({ ...current, [method.kind]: event.target.value })); if (error) setError(""); }}
            inputMode={method.inputMode ?? "text"}
            type={method.kind === "email" ? "email" : "text"}
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            placeholder={method.placeholder}
            aria-invalid={Boolean(problem)}
            aria-describedby={`tag-contact-${method.kind}-hint`}
            className={`${CX.input} w-full pl-10 ${problem ? "!border-rose-500" : ""}`}
          />
        </div>
        <p id={`tag-contact-${method.kind}-hint`} className={problem ? "mt-1.5 text-[13px] leading-5 text-rose-700" : CX.helper}>{problem || method.hint}</p>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      dismissible={!busy}
      size="lg"
      tone="navy"
      icon={<QrCode size={21} />}
      eyebrow="Smart Tag contact settings"
      title="What finders see on your tag"
      description="Save your details once, then switch them on tag by tag. Nothing is shown until you do."
      footer={setup ? (
        <button type="button" onClick={onClose} className={CX.btnNavy}>Close</button>
      ) : (
        <>
          <button type="button" onClick={onClose} disabled={busy} className={CX.btnGhost}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy || !dirty || saved === null} className={CX.btnGold}>{busy ? "Saving…" : "Save settings"}</button>
        </>
      )}
    >
      {saved === null ? (
        <div className="space-y-3" aria-busy="true"><SkeletonBlock className="h-24 w-full rounded-2xl" /><SkeletonBlock className="h-56 w-full rounded-2xl" /></div>
      ) : (
        <div className="space-y-7">
          {setup && <p role="status" className="rounded-2xl border border-gold-300 bg-gold-50 px-4 py-3 text-[14px] leading-6 text-ink-soft">Contact methods switch on after the next database update. Your preferences below still work on this device.</p>}

          {/* Preview of the finder's view */}
          <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0e1830_0%,#1f3160_100%)] p-4 text-white ring-1 ring-white/10">
            <span className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-gold-400/20 blur-2xl" aria-hidden="true" />
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-gold-300"><Eye size={13} aria-hidden="true" />A finder sees, on tags where you switch them on</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-[15px] font-bold text-gold-200 ring-2 ring-gold-400/70">{initials(fullName).replace(/[.\s]/g, "").slice(0, 2) || "?"}</span>
              <div className="min-w-0">
                <p className="truncate text-[16px] font-semibold">{shownName}</p>
                <p className="text-[12.5px] text-white/60">This item belongs to</p>
              </div>
            </div>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {filled.length ? filled.map((method) => (
                <li key={method.kind} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-medium ring-1 ring-white/15"><ContactIcon kind={method.kind} size={13} />{method.label}</li>
              )) : <li className="text-[12.5px] text-white/60">No contact methods saved yet. Finders can still press "I found this item" and we notify you.</li>}
            </ul>
          </div>

          <Section title="Your name" icon={<UserRound size={16} />} note="Taken from your profile. Shown only on tags where you switch on Show my name.">
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-frost-50/80 px-4 py-3">
              <UserRound size={17} className="shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{fullName}</span>
              <span className="shrink-0 text-[12px] text-ink-muted">From your profile</span>
            </div>
            <Segmented<TagSettings["name_display"]>
              label="How your name appears"
              value={settings.name_display}
              onChange={(value) => setSettings((current) => ({ ...current, name_display: value }))}
              options={[{ value: "full", label: "Show my full name" }, { value: "initials", label: "Show initials only" }]}
            />
          </Section>

          <Section title="Ways to reach you" icon={<Radio size={16} />} note="We build every link ourselves from your username, so a finder is only ever sent to the real service.">
            <div className="grid gap-4 sm:grid-cols-2">{CONTACT_KINDS.filter((method) => method.main).map(field)}</div>
            <button type="button" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} className="flex min-h-[44px] items-center gap-2 text-[14px] font-semibold text-iris-700 hover:underline">
              <ChevronDown size={16} className={`transition-transform ${moreOpen ? "rotate-180" : ""}`} aria-hidden="true" />More ways: Instagram, Telegram, WhatsApp
            </button>
            {moreOpen && <div className="grid gap-4 sm:grid-cols-2">{CONTACT_KINDS.filter((method) => !method.main).map(field)}</div>}
            {onManageTags && (
              <button type="button" onClick={onManageTags} className="flex w-full items-center gap-3 rounded-2xl border border-iris-200 bg-iris-50/70 px-4 py-3 text-left transition-colors hover:bg-iris-50">
                <ShieldCheck size={18} className="shrink-0 text-iris-700" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-[13.5px] leading-5 text-ink-soft"><span className="block font-semibold text-ink">Choose what each tag shows</span>Open a tag on My Smart Tags and choose Manage, then Edit.</span>
                <ArrowRight size={16} className="shrink-0 text-iris-700" aria-hidden="true" />
              </button>
            )}
          </Section>

          <Section title="Preferences" icon={<BellRing size={16} />}>
            <SwitchRow
              checked={sound}
              onChange={(on) => { setSound(on); if (on) playNotificationChime(true); }}
              label="Notification sound"
              hint="A soft chime when a new notification arrives. Applies to this device right away."
              icon={<Volume2 size={18} />}
              action={sound ? <button type="button" onClick={() => playNotificationChime(true)} className="hidden min-h-[36px] rounded-lg px-2.5 text-[12.5px] font-semibold text-gold-800 hover:bg-gold-100 sm:block">Test</button> : undefined}
            />
            <div>
              <p className={CX.label}><Languages size={14} className="mr-1.5 inline text-gold-700" aria-hidden="true" />Language of your tag page</p>
              <Segmented<TagSettings["language"]>
                label="Language of your tag page"
                value={settings.language}
                onChange={(value) => setSettings((current) => ({ ...current, language: value }))}
                options={[{ value: "en", label: "English" }, { value: "fil", label: "Filipino" }]}
              />
              <p className={CX.helper}>The page a finder sees when they scan your tag. The rest of E-Balik is in English.</p>
            </div>
            <div>
              <p className={CX.label}>Theme</p>
              <Segmented<ThemePreference>
                label="Theme"
                value={themePreference}
                onChange={setThemePreference}
                options={[
                  { value: "light", label: "Light", icon: <Sun size={15} aria-hidden="true" /> },
                  { value: "dark", label: "Dark", icon: <Moon size={15} aria-hidden="true" /> },
                  { value: "system", label: "System", icon: <Monitor size={15} aria-hidden="true" /> },
                ]}
              />
              <p className={CX.helper}>Applies to this device right away. System follows your phone or computer.</p>
            </div>
          </Section>

          {error && <p role="alert" className={CX.alertError}>{error}</p>}
        </div>
      )}
    </Modal>
  );
}

/** The Profile entry: a glass card button with a short summary, opening the settings window. */
export function SmartTagContactCard({ onManageTags }: { onManageTags?: () => void }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<{ count: number; settings: TagSettings } | null>(null);

  useEffect(() => {
    let active = true;
    tagsApi.contacts()
      .then((result) => { if (active) setSummary({ count: Object.values(result.contacts ?? {}).filter(Boolean).length, settings: { ...DEFAULT_TAG_SETTINGS, ...(result.settings ?? {}) } }); })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, []);

  const details = summary
    ? `${summary.count ? `${summary.count} contact ${summary.count === 1 ? "method" : "methods"} saved` : "No contact methods yet"} · ${summary.settings.name_display === "initials" ? "Initials only" : "Full name"} · ${summary.settings.language === "fil" ? "Filipino" : "English"} tag page`
    : "Name, phone, email and social links, plus sound and theme";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative flex w-full items-center gap-4 overflow-hidden rounded-[22px] border border-white/80 bg-white/85 p-5 text-left shadow-card ring-1 ring-navy-900/[0.04] backdrop-blur-xl transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-raised sm:p-6"
      >
        <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.8),transparent)]" aria-hidden="true" />
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300 shadow-[0_10px_22px_-12px_rgba(31,49,96,0.9)]" aria-hidden="true"><Radio size={22} /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-[family-name:var(--font-heading)] text-[17px] font-semibold text-ink">Smart Tag contact settings</span>
          <span className="mt-0.5 block text-[13.5px] leading-5 text-ink-muted">Choose what finders see when they scan your tags.</span>
          <span className="mt-1.5 block truncate text-[12.5px] font-medium text-gold-800">{details}</span>
        </span>
        <ArrowRight size={20} className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-1 group-hover:text-navy-800" aria-hidden="true" />
      </button>
      <SmartTagContactModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(contacts, settings) => setSummary({ count: Object.values(contacts).filter(Boolean).length, settings })}
        onManageTags={onManageTags ? () => { setOpen(false); onManageTags(); } : undefined}
      />
    </>
  );
}
