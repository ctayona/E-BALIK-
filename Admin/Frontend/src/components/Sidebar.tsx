import { useEffect, useState } from "react";
import umakLogo from "../imports/UMak Logo.png";
import { AdminUser } from "../utils/api";
import { useT, tr } from "../utils/preferences";
import type { StringKey } from "../i18n/strings";
import { Gavel } from "lucide-react";

type Page = "dashboard" | "lost-items" | "found-items" | "ai-matching" | "auctions" | "claims" | "chain-of-custody" | "users" | "reports" | "notifications" | "activity-logs" | "admin-profile";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  notifCount: number;
  user: AdminUser;
  onLogout: () => void;
}

const GROUP_ORDER: { id: string; label: StringKey }[] = [
  { id: "Overview", label: "nav.group.overview" },
  { id: "Items", label: "nav.group.items" },
  { id: "Claims & people", label: "nav.group.people" },
  { id: "System", label: "nav.group.system" },
];

const navItems = [
  { id: "dashboard" as Page, group: "Overview", label: "nav.dashboard" as StringKey, icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity=".6"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity=".6"/><rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4"/></svg>
  )},
  { id: "lost-items" as Page, group: "Items", label: "nav.lostItems" as StringKey, icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="m21 21-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  )},
  { id: "found-items" as Page, group: "Items", label: "nav.foundItems" as StringKey, icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/></svg>
  )},
  { id: "ai-matching" as Page, group: "Items", label: "nav.aiMatching" as StringKey, icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="2" y="6" width="8" height="12" rx="2" stroke="currentColor" strokeWidth="2"/><rect x="14" y="6" width="8" height="12" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M10 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  )},
  { id: "auctions" as Page, group: "Items", label: "nav.auctions" as StringKey, icon: <Gavel size={18} aria-hidden="true" /> },
  { id: "claims" as Page, group: "Claims & people", label: "nav.claims" as StringKey, icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>
  )},
  { id: "chain-of-custody" as Page, group: "Items", label: "nav.custody" as StringKey, icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  )},
  { id: "users" as Page, group: "Claims & people", label: "nav.users" as StringKey, icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  )},
  { id: "reports" as Page, group: "Overview", label: "nav.reports" as StringKey, icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M3 3v18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="m7 16 4-5 4 3 4-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  )},
  { id: "notifications" as Page, group: "System", label: "nav.notifications" as StringKey, icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  ), notifBadge: true },
  { id: "activity-logs" as Page, group: "System", label: "nav.activityLogs" as StringKey, icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  )},
];

export default function Sidebar({ currentPage, onNavigate, notifCount, user, onLogout }: SidebarProps) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  function navigate(page: Page) {
    onNavigate(page);
    setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <img src={umakLogo} alt={tr("University of Makati logo")} className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/10" />
            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-gold-500 ring-2 ring-navy-900" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-[family-name:var(--font-heading)] text-[15px] font-semibold leading-tight text-white">{tr("E-Balik Admin")}</div>
            <div className="text-[12px] font-medium leading-tight text-gold-300">{tr("University of Makati")}</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label={t("nav.label")}>
        {GROUP_ORDER.map((group) => (
          <div key={group.id} className="mb-5 last:mb-0">
            <div className="mb-1.5 px-3 text-[12.5px] font-medium text-navy-300/90">{t(group.label)}</div>
            <ul className="space-y-1">
              {navItems.filter((item) => item.group === group.id).map((item) => {
                const active = currentPage === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => navigate(item.id)}
                      aria-current={active ? "page" : undefined}
                      className={`group flex min-h-[42px] w-full items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-[background-color,color,box-shadow] duration-150 ${
                        active ? "gold-glow bg-[linear-gradient(180deg,#ecc787_0%,#d1a153_100%)] font-semibold text-navy-950" : "text-navy-200 hover:bg-white/[0.07] hover:text-white"
                      }`}
                    >
                      <span className={`shrink-0 ${active ? "text-navy-950" : "text-navy-300 group-hover:text-gold-200"}`} aria-hidden="true">{item.icon}</span>
                      <span className="flex-1 truncate text-left">{t(item.label)}</span>
                      {item.notifBadge && notifCount > 0 && (
                        <span className="min-w-[22px] rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[12px] font-bold text-white" aria-label={tr("{0} unread", { "0": notifCount })}>{notifCount}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={() => navigate("admin-profile")}
          aria-current={currentPage === "admin-profile" ? "page" : undefined}
          className={`mb-1 flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors ${currentPage === "admin-profile" ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"}`}
        >
          <div className="flex size-9 items-center justify-center rounded-lg bg-gold-500 text-[13px] font-bold text-navy-950">
            {user.fname[0]}{user.lname[0]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-white">{user.fname} {user.lname}</div>
            <div className="text-[12px] text-navy-200">{user.access_level === "super_admin" ? t("role.superAdmin") : t("role.admin")}</div>
          </div>
        </button>
        <button
          onClick={onLogout}
          type="button"
          className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2 text-[14px] font-medium text-rose-300 transition-colors hover:bg-rose-500/10"
        >
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {t("header.logout")}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="print-hide sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-navy-950 bg-[linear-gradient(180deg,#1b2c58_0%,#121f42_100%)] md:flex dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(14,22,46,0.82),rgba(7,12,25,0.88))] dark:backdrop-blur-xl">
        {sidebarContent}
      </aside>

      {/* Mobile hamburger button */}
      <button
        type="button"
        className="print-hide gold-glow fixed bottom-5 right-5 z-40 flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#ecc787_0%,#d1a153_100%)] text-navy-950 md:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label={t("nav.open")}
      >
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="print-hide fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-navy-950/55 backdrop-blur-[3px]" onClick={() => setMobileOpen(false)} />
          <aside role="dialog" aria-modal="true" aria-label={t("nav.label")} className="relative z-10 flex h-full w-[284px] max-w-[85vw] flex-col bg-[linear-gradient(180deg,#1b2c58_0%,#121f42_100%)] shadow-overlay dark:bg-[linear-gradient(180deg,#0e162e,#070c19)]">
            <div className="flex justify-end p-3">
              <button type="button" onClick={() => setMobileOpen(false)} aria-label={t("nav.close")} className="flex size-11 items-center justify-center rounded-lg text-navy-200 transition-colors hover:bg-white/10 hover:text-white">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
