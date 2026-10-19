import { BellRing, Contrast, LayoutPanelLeft, Monitor, Moon, Newspaper, QrCode, RotateCcw, Settings2, Sparkles, Sun, Type, Volume2 } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import { Section, Segmented, SwitchRow } from "@/app/shared/tags/SmartTagContactModal";
import { showToast } from "@/app/shared/toast/toastStore";
import { CX } from "@/app/utils/clay";
import { playNotificationChime, useNotificationSound } from "@/app/utils/notificationSound";
import { resetPreferences, updatePreferences, usePreferences, type FeedTab, type TextSize } from "@/app/utils/preferences";
import { useThemePreference, type ThemePreference } from "@/app/utils/theme";
import type { Page } from "@/app/types";

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

/**
 * Page settings, opened from the account menu. Everything here is kept on this device and applies at once (no Save button): the theme,
 * the text size, reduced motion, the feed that opens first, a feed-only Home page and the notification sound.
 * Account-level choices (Smart Tag contact details, email preferences) live on the Profile; the links at the bottom go there.
 */
export default function UserSettingsModal({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (page: Page) => void }) {
  const prefs = usePreferences();
  const [theme, setTheme] = useThemePreference();
  const [sound, setSound] = useNotificationSound();

  const go = (page: Page) => {
    onClose();
    onNavigate(page);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      tone="navy"
      icon={<Settings2 size={21} />}
      eyebrow="Settings"
      title="Make E-Balik yours"
      description="These choices stay on this device and apply right away."
      footer={(
        <>
          <button type="button" onClick={() => { resetPreferences(); setTheme("system"); setSound(false); showToast("Settings reset to default"); }} className={CX.btnGhost}>
            <RotateCcw size={15} aria-hidden="true" />Reset to default
          </button>
          <button type="button" onClick={onClose} className={CX.btnNavy}>Done</button>
        </>
      )}
    >
      <div className="space-y-6">
        <Section title="Appearance" icon={<Contrast size={17} />}>
          <Segmented label="Theme" value={theme} options={THEMES} onChange={setTheme} />
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-ink-soft"><Type size={15} className="text-ink-muted" aria-hidden="true" />Text size</p>
            <Segmented label="Text size" value={prefs.textSize} options={TEXT_SIZES} onChange={(textSize) => updatePreferences({ textSize })} />
            <p className="mt-2 rounded-xl bg-frost-100 px-3 py-2 text-[14px] leading-6 text-ink-soft">The quick brown fox looks for a lost wallet near the library.</p>
          </div>
          <SwitchRow
            checked={prefs.reduceMotion}
            onChange={(reduceMotion) => updatePreferences({ reduceMotion })}
            label="Reduce motion"
            hint="Turns off sliding, fading and spinning effects. Helpful if animations make you dizzy."
            icon={<Sparkles size={18} />}
          />
        </Section>

        <Section title="Home" icon={<Newspaper size={17} />} note="Choose what you see first when you open E-Balik.">
          <div>
            <p className="mb-1.5 text-[13.5px] font-semibold text-ink-soft">Open the feed on</p>
            <Segmented label="Home feed that opens first" value={prefs.homeFeed} options={FEEDS} onChange={(homeFeed) => updatePreferences({ homeFeed })} />
          </div>
          <SwitchRow
            checked={prefs.focusFeed}
            onChange={(focusFeed) => updatePreferences({ focusFeed })}
            label="Feed only"
            hint="Hide the shortcut and office columns on wide screens for a calmer, centred feed."
            icon={<LayoutPanelLeft size={18} />}
          />
        </Section>

        <Section title="Notifications" icon={<BellRing size={17} />}>
          <SwitchRow
            checked={sound}
            onChange={setSound}
            label="Sound for new notifications"
            hint="A short chime when something new arrives while E-Balik is open."
            icon={<Volume2 size={18} />}
            action={sound ? <button type="button" onClick={() => playNotificationChime(true)} className="shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-iris-700 hover:bg-iris-50">Test</button> : undefined}
          />
        </Section>

        <Section title="More settings" icon={<QrCode size={17} />} note="These follow your account, not this device.">
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => go("profile")} className={`${CX.btnGhost} justify-start`}>Smart Tag contact details</button>
            <button type="button" onClick={() => go("profile")} className={`${CX.btnGhost} justify-start`}>Email preferences &amp; verification</button>
          </div>
        </Section>
      </div>
    </Modal>
  );
}
