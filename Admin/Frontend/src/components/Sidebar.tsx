import { useEffect, useState } from "react";
import umakLogo from "../imports/UMak Logo.png";
import { AdminUser } from "../utils/api";

type Page = "dashboard" | "lost-items" | "found-items" | "ai-matching" | "claims" | "chain-of-custody" | "users" | "reports" | "notifications" | "activity-logs" | "admin-profile";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  notifCount: number;
  user: AdminUser;
  onLogout: () => void;
}

const GROUP_ORDER = ["Overview", "Items", "Claims & people", "System"] as const;

const navItems = [
  { id: "dashboard" as Page, group: "Overview", label: "Dashboard", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity=".6"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity=".6"/><rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity=".4"/></svg>
  )},
  { id: "lost-items" as Page, group: "Items", label: "Lost Items", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="m21 21-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  )},
  { id: "found-items" as Page, group: "Items", label: "Found Items", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/></svg>
  )},
  { id: "ai-matching" as Page, group: "Items", label: "AI Matching", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="2" y="6" width="8" height="12" rx="2" stroke="currentColor" strokeWidth="2"/><rect x="14" y="6" width="8" height="12" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M10 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  )},
  { id: "claims" as Page, group: "Claims & people", label: "Claims & Verification", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>
  )},
  { id: "chain-of-custody" as Page, group: "Items", label: "Chain of Custody", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  )},
  { id: "users" as Page, group: "Claims & people", label: "Users", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  )},
  { id: "reports" as Page, group: "Overview", label: "Reports & Analytics", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M3 3v18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="m7 16 4-5 4 3 4-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  )},
  { id: "notifications" as Page, group: "System", label: "Notifications", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  ), notifBadge: true },
  { id: "activity-logs" as Page, group: "System", label: "Activity Logs", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  )},
];

export default function Sidebar({ currentPage, onNavigate, notifCount, user, onLogout }: SidebarProps) {
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
            <img src={umakLogo} alt="University of Makati logo" className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/10" />
            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-gold-500 ring-2 ring-navy-900" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-[family-name:var(--font-heading)] text-[15px] font-semibold leading-tight text-white">E-Balik Admin</div>
            <div className="text-[12px] font-medium leading-tight text-gold-300">University of Makati</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Admin navigation">
        {GROUP_ORDER.map((group) => (
          <div key={group} className="mb-4 last:mb-0">
            <div className="mb-1.5 px-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-navy-300">{group}</div>
            <ul className="space-y-0.5">
              {navItems.filter((item) => item.group === group).map((item) => {
                const active = currentPage === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => navigate(item.id)}
                      aria-current={active ? "page" : undefined}
                      className={`group flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 text-[14px] font-medium transition-colors duration-150 ${
                        active ? "bg-white/[0.12] text-white " : "text-navy-200 hover:bg-white/[0.06] hover:text-white"
                      }`}
                    >
                      <span className={`shrink-0 ${active ? "text-gold-400" : "text-navy-300 group-hover:text-navy-100"}`} aria-hidden="true">{item.icon}</span>
                      <span className="flex-1 truncate text-left">{item.label}</span>
                      {item.notifBadge && notifCount > 0 && (
                        <span className="min-w-[22px] rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[12px] font-bold text-white" aria-label={`${notifCount} unread`}>{notifCount}</span>
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
            <div className="text-[12px] text-navy-200">{user.access_level === "super_admin" ? "Super Admin" : "Admin"}</div>
          </div>
        </button>
        <button
          onClick={onLogout}
          type="button"
          className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2 text-[14px] font-medium text-rose-300 transition-colors hover:bg-rose-500/10"
        >
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Log out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="print-hide sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-navy-950 bg-navy-900 md:flex">
        {sidebarContent}
      </aside>

      {/* Mobile hamburger button */}
      <button
        type="button"
        className="print-hide fixed bottom-5 right-5 z-40 flex size-12 items-center justify-center rounded-xl bg-navy-800 text-white shadow-raised md:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="print-hide fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-navy-950/55 backdrop-blur-[3px]" onClick={() => setMobileOpen(false)} />
          <aside role="dialog" aria-modal="true" aria-label="Admin navigation" className="relative z-10 flex h-full w-[284px] max-w-[85vw] flex-col bg-navy-900 shadow-overlay">
            <div className="flex justify-end p-3">
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="flex size-11 items-center justify-center rounded-lg text-navy-200 transition-colors hover:bg-white/10 hover:text-white">
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
