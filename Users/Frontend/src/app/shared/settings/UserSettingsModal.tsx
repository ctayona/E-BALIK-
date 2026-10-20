import { useEffect, useState } from "react";
import {
  BadgeCheck, BellRing, Contrast, Eraser, ExternalLink, KeyRound, LayoutPanelLeft, Link2, LogOut, Monitor, Moon, Newspaper, Palette,
  QrCode, RotateCcw, Settings2, ShieldCheck, Smartphone, Sparkles, Sun, Type, UserRound, Volume2, Zap,
} from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import SmartTagContactModal, { Section, Segmented, SwitchRow } from "@/app/shared/tags/SmartTagContactModal";
import EmailPreferenceRows from "@/app/shared/profile/EmailPreferencesCard";
import ForgotPasswordModal from "@/app/pages/home/ForgotPasswordModal";
import { showToast } from "@/app/shared/toast/toastStore";
import { CX } from "@/app/utils/clay";
import { playNotificationChime, useNotificationSound } from "@/app/utils/notificationSound";
import { clearDeviceChoices, resetPreferences, updatePreferences, usePreferences, type FeedTab, type TextSize } from "@/app/utils/preferences";
import { useThemePreference, type ThemePreference } from "@/app/utils/theme";
import { useCurrentUser } from "@/app/utils/system";
import type { Page } from "@/app/types";

export type SettingsTab = "appearance" | "home" | "notifications" | "privacy" | "account";

const TABS: Array<{ id: SettingsTab; label: string; hint: string; icon: React.ReactNode }> = [
  { id: "appearance", label: "Appearance", hint: "Theme, text and motion", icon: <Palette size={17} aria-hidden="true" /> },
  { id: "home", label: "Home feed", hint: "What opens first", icon: <Newspaper size={17} aria-hidden="true" /> },
  { id: "notifications", label: "Notifications", hint: "Sound, badge and email", icon: <BellRing size={17} aria-hidden="true" /> },
  { id: "privacy", label: "Privacy & Smart Tags", hint: "What finders see", icon: <ShieldCheck size={17} aria-hidden="true" /> },
  { id: "account", label: "Account & security", hint: "Password and sign-in", icon: <UserRound size={17} aria-hidden="true" /> },
];

const THEMES: Array<{ value: ThemePreference; label: string; icon: React.ReactNode }> = [
  { value: "light", label: "Light", icon: <Sun size={15} aria-hidden="true" /> },
  { value: "dark", label: "Dark", icon: <Moon size={15} aria-hidden="true" /> },
  { value: "system", label: "Auto", icon: <Monitor size={15} aria-hidden="true" /> },
];
const TEXT_SIZES: Array<{ value: TextSize; label: string }> = [
  { value: "small", label: "Small" },
  { value: "default", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "Extra large" },
];
const FEEDS: Array<{ value: FeedTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "found", label: "Found" },
  { value: "missing", label: "Missing" },
  { value: "auctions", label: "Auctions" },
];

/** Settings > a tab can be opened from anywhere (the Profile page links here) with `openSettings("notifications")`. */
export const OPEN_SETTINGS_EVENT = "ebalik-open-settings";
export function openSettings(tab: SettingsTab = "appearance") {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { tab } }));
}

const badgeSupported = () => typeof navigator !== "undefined" && "setAppBadge" in navigator;

/**
 * The settings center, opened from the account menu (or from Profile). Device choices (appearance, home, sound, badge) apply at once and
 * stay on this device; account choices (email, Smart Tag contact details, password) are saved to the account. No Save button.
 */
export default function UserSettingsModal({ open, onClose, onNavigate, onLogout, initialTab = "appearance" }: {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: Page) => void;
  onLogout?: () => void;
  initialTab?: SettingsTab;
}) {
  const prefs = usePreferences();
  const user = useCurrentUser();
  const [theme, setTheme] = useThemePreference();
  const [sound, setSound] = useNotificationSound();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [tagSettings, setTagSettings] = useState(false);
  const [password, setPassword] = useState(false);

  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);

  const go = (page: Page) => {
    onClose();
    onNavigate(page);
  };
  const active = TABS.find((entry) => entry.id === tab) ?? TABS[0];

  return (
    <>
      <Modal
        open={open && !tagSettings && !password}
        onClose={onClose}
        size="xl"
        tone="navy"
        icon={<Settings2 size={21} />}
        eyebrow="Settings"
        title="Make E-Balik yours"
        description="Device choices apply right away. Account choices follow you to every device."
        bodyClassName="!p-0"
        footer={(
          <>
            <button type="button" onClick={() => { resetPreferences(); setTheme("system"); setSound(false); showToast("Device settings reset to default"); }} className={`${CX.btnGhost} sm:mr-auto`}>
              <RotateCcw size={15} aria-hidden="true" />Reset device settings
            </button>
            <button type="button" onClick={onClose} className={CX.btnNavy}>Done</button>
          </>
        )}
      >
        <div className="grid min-h-0 sm:grid-cols-[220px_minmax(0,1fr)]">
          {/* Section menu: a side rail on wider screens, a scrolling row on phones. */}
          <nav aria-label="Settings sections" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line bg-frost-50/70 p-2 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={tab === entry.id ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors sm:w-full ${tab === entry.id ? "bg-[linear-gradient(180deg,#2b4282_0%,#1f3160_100%)] text-white shadow-[0_8px_18px_-10px_rgba(17,27,66,0.8)]" : "text-ink-soft hover:bg-white/80"}`}
              >
                <span className={tab === entry.id ? "text-gold-300" : "text-ink-muted"}>{entry.icon}</span>
                <span className="min-w-0">
                  <span className="block whitespace-nowrap text-[13.5px] font-semibold">{entry.label}</span>
                  <span className={`hidden text-[11.5px] sm:block ${tab === entry.id ? "text-navy-100" : "text-ink-muted"}`}>{entry.hint}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 space-y-6 p-5 sm:p-6" role="region" aria-label={active.label}>
            {tab === "appearance" && (
              <>
                <Section title="Theme" icon={<Contrast size={17} />}>
                  <Segmented label="Theme" value={theme} options={THEMES} onChange={setTheme} />
                </Section>
                <Section title="Text size" icon={<Type size={17} />} note="Every page grows or shrinks together.">
                  <Segmented label="Text size" value={prefs.textSize} options={TEXT_SIZES} onChange={(textSize) => updatePreferences({ textSize })} />
                  <p className="rounded-xl bg-frost-100 px-3.5 py-2.5 text-[14px] leading-6 text-ink-soft">Preview: a black wallet was handed in at the Library guard post this morning.</p>
                </Section>
                <Section title="Accessibility" icon={<Sparkles size={17} />}>
                  <SwitchRow checked={prefs.reduceMotion} onChange={(reduceMotion) => updatePreferences({ reduceMotion })} label="Reduce motion" hint="Turns off sliding, fading and spinning effects." icon={<Zap size={18} />} />
                  <SwitchRow checked={prefs.highContrast} onChange={(highContrast) => updatePreferences({ highContrast })} label="High contrast" hint="Darker text and firmer borders, for bright rooms and tired eyes." icon={<Contrast size={18} />} />
                  <SwitchRow checked={prefs.underlineLinks} onChange={(underlineLinks) => updatePreferences({ underlineLinks })} label="Underline links" hint="Makes every link easy to spot without relying on colour." icon={<Link2 size={18} />} />
                </Section>
              </>
            )}

            {tab === "home" && (
              <>
                <Section title="Open the feed on" icon={<Newspaper size={17} />} note="The tab you see first when you open E-Balik.">
                  <Segmented label="Home feed that opens first" value={prefs.homeFeed} options={FEEDS} onChange={(homeFeed) => updatePreferences({ homeFeed })} />
                </Section>
                <Section title="Layout" icon={<LayoutPanelLeft size={17} />}>
                  <SwitchRow checked={prefs.focusFeed} onChange={(focusFeed) => updatePreferences({ focusFeed })} label="Feed only" hint="Hide the shortcut and office columns on wide screens for a calm, centred feed." icon={<LayoutPanelLeft size={18} />} />
                  <SwitchRow checked={prefs.showStories} onChange={(showStories) => updatePreferences({ showStories })} label="Urgent this week" hint="The row of IDs, wallets, phones and keys people need back fast." icon={<Sparkles size={18} />} />
                </Section>
              </>
            )}

            {tab === "notifications" && (
              <>
                <Section title="On this device" icon={<Smartphone size={17} />}>
                  <SwitchRow checked={sound} onChange={setSound} label="Sound for new notifications" hint="A short chime when something new arrives while E-Balik is open." icon={<Volume2 size={18} />}
                    action={sound ? <button type="button" onClick={() => playNotificationChime(true)} className="shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-iris-700 hover:bg-iris-50">Test</button> : undefined} />
                  <SwitchRow checked={prefs.appBadge} onChange={(appBadge) => updatePreferences({ appBadge })} label="Unread count on the app icon"
                    hint={badgeSupported() ? "When E-Balik is installed, its icon shows how many notifications are unread." : "Works when E-Balik is installed as an app on a device that supports icon badges."} icon={<BadgeCheck size={18} />} />
                </Section>
                <Section title="Email" icon={<BellRing size={17} />} note="Saved to your account. Codes, claim approvals and other important messages are always sent.">
                  <EmailPreferenceRows />
                </Section>
              </>
            )}

            {tab === "privacy" && (
              <>
                <Section title="Smart Tag contact details" icon={<QrCode size={17} />} note="What a finder sees when they scan one of your tags. Nothing shows until you switch it on for a tag.">
                  <button type="button" onClick={() => setTagSettings(true)} className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-white/80 p-4 text-left transition hover:border-gold-300 hover:bg-gold-50">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300" aria-hidden="true"><QrCode size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold text-ink">Open contact settings</span>
                      <span className="block text-[12.5px] text-ink-muted">Phone, email, social links, how your name appears, and the language of your tag page.</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => go("my-tags")} className={`${CX.btnGhost} w-full justify-center sm:w-auto`}><QrCode size={15} aria-hidden="true" />Manage my Smart Tags</button>
                </Section>
                <Section title="Your data" icon={<ShieldCheck size={17} />}>
                  <a href="/privacy" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-line bg-white/80 p-4 transition hover:border-iris-300">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-frost-100 text-iris-700" aria-hidden="true"><ShieldCheck size={18} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[14.5px] font-semibold text-ink">How we use your data</span><span className="block text-[12.5px] text-ink-muted">The Data Privacy Act notice for E-Balik.</span></span>
                    <ExternalLink size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                  </a>
                  <button type="button" onClick={() => { clearDeviceChoices(); setTheme("system"); setSound(false); showToast("Saved choices on this device were cleared"); }} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white/80 p-4 text-left transition hover:border-rose-200 hover:bg-rose-50">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-700" aria-hidden="true"><Eraser size={18} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[14.5px] font-semibold text-ink">Clear saved choices on this device</span><span className="block text-[12.5px] text-ink-muted">Forgets the theme, text size, last page and view mode here. You stay signed in.</span></span>
                  </button>
                </Section>
              </>
            )}

            {tab === "account" && (
              <>
                <Section title="Your account" icon={<UserRound size={17} />}>
                  <div className="flex items-center gap-3 rounded-2xl border border-line bg-frost-50 p-4">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-[14px] font-bold text-navy-950" aria-hidden="true">{`${user?.fname?.[0] ?? ""}${user?.lname?.[0] ?? ""}`.toUpperCase() || "U"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">{`${user?.fname ?? ""} ${user?.lname ?? ""}`.trim() || "Your account"}</span>
                      <span className="block truncate text-[12.5px] text-ink-muted">{user?.email}</span>
                    </span>
                    <button type="button" onClick={() => go("profile")} className={`${CX.btnGhost} shrink-0`}>Profile</button>
                  </div>
                </Section>
                <Section title="Security" icon={<KeyRound size={17} />} note="We email a 6-digit code to confirm it is you before the password changes.">
                  <button type="button" onClick={() => setPassword(true)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white/80 p-4 text-left transition hover:border-gold-300 hover:bg-gold-50">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><KeyRound size={18} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[14.5px] font-semibold text-ink">Change password</span><span className="block text-[12.5px] text-ink-muted">At least 16 characters, with upper and lower case, a number and a symbol.</span></span>
                  </button>
                  {onLogout && (
                    <button type="button" onClick={() => { onClose(); onLogout(); }} className={`${CX.btnGhost} w-full justify-center border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50 sm:w-auto`}><LogOut size={15} aria-hidden="true" />Sign out of this device</button>
                  )}
                </Section>
              </>
            )}
          </div>
        </div>
      </Modal>

      <SmartTagContactModal open={open && tagSettings} onClose={() => setTagSettings(false)} onManageTags={() => { setTagSettings(false); go("my-tags"); }} />
      {open && password && (
        <div className="ui-modal-backdrop fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-navy-950/60 backdrop-blur-md sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPassword(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Change password" className="w-full sm:w-auto">
            <ForgotPasswordModal onClose={() => setPassword(false)} onBackToLogin={() => setPassword(false)} />
          </div>
        </div>
      )}
    </>
  );
}
