import { useEffect, useState } from "react";
import { Bell, ChevronDown, ChevronRight, LockKeyhole, Moon, Sun } from "lucide-react";
import umakLogo from "../imports/UMak Logo.png";
import { AdminUser } from "../utils/api";
import { fetchPublicSystemStatus } from "../utils/systemApi";
import { useLanguage, useT, useTheme, tr } from "../utils/preferences";
import type { Language } from "../i18n/strings";

interface HeaderProps {
  breadcrumb: string[];
  title: string;
  notifCount: number;
  onNotifClick: () => void;
  onProfileClick: () => void;
  user: AdminUser;
  onLogout: () => void;
}

const LANGUAGES: { id: Language; short: string; name: string }[] = [
  { id: "en", short: "EN", name: "English" },
  { id: "tl", short: "TL", name: "Tagalog" },
];

export default function Header({ breadcrumb, title, notifCount, onNotifClick, onProfileClick, user, onLogout }: HeaderProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const [language, setLanguage] = useLanguage();
  const t = useT();
  const [maintenance, setMaintenance] = useState(false);
  const roleLabel = user.access_level === "super_admin" ? t("role.superAdmin") : t("role.admin");

  useEffect(() => {
    document.title = "E-Balik Admin";
    let favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.appendChild(favicon);
    }
    favicon.href = umakLogo;
  }, []);

  // Admins keep working during maintenance, so remind them the app is locked for everyone else.
  useEffect(() => {
    let active = true;
    const check = () => { if (!document.hidden) fetchPublicSystemStatus().then((status) => { if (active) setMaintenance(status.maintenance); }).catch(() => undefined); };
    check();
    const timer = window.setInterval(check, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  // Close profile dropdown on outside click or Escape
  useEffect(() => {
    if (!profileOpen) return;
    const handleClick = () => setProfileOpen(false);
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") setProfileOpen(false); };
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [profileOpen]);

  const iconButton = "relative flex size-11 items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-navy-50 hover:text-ink";

  return (
    <header className="print-hide sticky top-0 z-20 flex min-h-[68px] shrink-0 items-center justify-between gap-3 border-b border-line bg-[var(--chrome)] px-4 py-2.5 backdrop-blur-xl sm:px-6">
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.5),transparent)]" aria-hidden="true" />
      <div className="min-w-0">
        <nav aria-label={tr("Breadcrumb")} className="hidden items-center gap-1 text-[12.5px] font-medium text-ink-muted sm:flex">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="text-slate-300" aria-hidden="true" />}
              <span className={i === breadcrumb.length - 1 ? "text-ink-soft" : ""} aria-current={i === breadcrumb.length - 1 ? "page" : undefined}>{b}</span>
            </span>
          ))}
        </nav>
        <p className="mt-0.5 truncate font-[family-name:var(--font-heading)] text-[19px] font-semibold leading-tight text-ink">{title}</p>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        {maintenance && (
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-rose-50 p-2 text-[12.5px] font-semibold text-rose-700 ring-1 ring-rose-200 xl:px-3 xl:py-1.5 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-500/40" role="status" title={tr("Maintenance mode is ON")}>
            <LockKeyhole size={14} aria-hidden="true" /><span className="hidden xl:inline">{tr("Maintenance mode is ON")}</span><span className="sr-only xl:hidden">{tr("Maintenance mode is ON")}</span>
          </span>
        )}
        {/* Language */}
        <div role="radiogroup" aria-label={t("header.language")} className="flex rounded-xl border border-line bg-frost-50 p-1">
          {LANGUAGES.map((option) => {
            const active = language === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={option.name}
                title={option.name}
                onClick={() => setLanguage(option.id)}
                className={`min-h-[32px] min-w-[38px] rounded-lg px-2 text-[12.5px] font-semibold transition-colors ${active ? "bg-navy-800 text-white shadow-sm dark:bg-[linear-gradient(180deg,#ecc787,#d1a153)] dark:text-navy-950" : "text-ink-muted hover:text-ink"}`}
              >
                {option.short}
              </button>
            );
          })}
        </div>

        {/* Theme */}
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={theme === "dark" ? t("header.themeToLight") : t("header.themeToDark")}
          title={theme === "dark" ? t("header.themeToLight") : t("header.themeToDark")}
          className={`${iconButton} dark:text-gold-300`}
        >
          {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </button>

        {/* Notifications */}
        <button type="button" onClick={onNotifClick} aria-label={notifCount > 0 ? t("header.notificationsUnread", { count: notifCount }) : t("header.notifications")} className={iconButton}>
          <Bell size={18} aria-hidden="true" />
          {notifCount > 0 && (
            <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white ring-2 ring-[var(--sticky-bg)]" aria-hidden="true">{notifCount}</span>
          )}
        </button>

        {/* Profile dropdown */}
        <div className="relative shrink-0">
          <button
            type="button"
            aria-expanded={profileOpen}
            aria-haspopup="menu"
            onClick={(e) => { e.stopPropagation(); setProfileOpen(open => !open); }}
            className="flex items-center gap-2 rounded-xl p-1.5 text-left transition-colors hover:bg-navy-50"
          >
            <div className="flex size-9 items-center justify-center rounded-xl bg-navy-800 text-[13px] font-bold text-white dark:bg-[linear-gradient(180deg,#ecc787,#d1a153)] dark:text-navy-950">{user.fname[0]}{user.lname[0]}</div>
            <div className="hidden text-sm lg:block">
              <div className="whitespace-nowrap text-[14px] font-semibold text-ink">{user.fname} {user.lname}</div>
              <div className="text-[12px] font-medium text-ink-muted">{roleLabel}</div>
            </div>
            <ChevronDown size={14} className={`ml-0.5 hidden text-slate-400 transition-transform lg:block ${profileOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden rounded-2xl border border-line bg-[var(--sticky-bg)] shadow-raised" role="menu" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-line px-4 py-3">
                <div className="text-[14px] font-semibold text-ink">{user.fname} {user.lname}</div>
                <div className="mt-0.5 text-[12px] text-ink-muted">{roleLabel}</div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setProfileOpen(false); onProfileClick(); }}
                className="block w-full px-4 py-2.5 text-left text-[14px] font-medium text-ink-soft transition-colors hover:bg-navy-50"
              >
                {t("header.profileSecurity")}
              </button>
              <div className="border-t border-line" />
              <button type="button" role="menuitem" onClick={onLogout} className="block w-full px-4 py-2.5 text-left text-[14px] font-medium text-rose-700 transition-colors hover:bg-rose-50">
                {t("header.logout")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
