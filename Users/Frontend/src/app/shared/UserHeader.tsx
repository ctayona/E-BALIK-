import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, ChevronDown, ClipboardCheck, Files, Gavel, GitCompareArrows, LayoutDashboard, LibraryBig, LogOut, Menu, Moon, PackagePlus, Sun, UserRound, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import headerUmSeal from "@/imports/Header/9aefa1789ba406d6291f8aa816f84df70a02953b.webp";
import type { Page } from "@/app/types";
import type { User } from "@/app/utils/useAuth";
import { notificationsAPI } from "@/app/utils/api";
import { useTheme } from "@/app/utils/theme";

const NAV_LINKS: { label: string; page: Page; icon: ReactNode }[] = [
  { label: "Dashboard",    page: "dashboard",    icon: <LayoutDashboard size={16} aria-hidden="true" /> },
  { label: "Browse",       page: "browse-items", icon: <LibraryBig size={16} aria-hidden="true" /> },
  { label: "Matches",      page: "matches",      icon: <GitCompareArrows size={16} aria-hidden="true" /> },
  { label: "My Reports",   page: "my-reports",   icon: <Files size={16} aria-hidden="true" /> },
  { label: "Claims",       page: "claim",        icon: <ClipboardCheck size={16} aria-hidden="true" /> },
  { label: "Auction Hall", page: "auction-hall", icon: <Gavel size={16} aria-hidden="true" /> },
];

const REPORT_PAGES: Page[] = ["report-item", "found-item", "missing-item"];

function initials(user: User | null) {
  if (!user) return "U";
  return `${user.fname?.[0] ?? ""}${user.lname?.[0] ?? ""}`.toUpperCase() || "U";
}

export default function UserHeader({
  currentPage,
  onNavigate,
  user,
  onLogout,
}: {
  currentPage: Page;
  onNavigate: (p: Page) => void;
  user: User | null;
  onLogout: () => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const accountRef = useRef<HTMLDivElement>(null);
  const [theme, toggleTheme] = useTheme();
  const themeLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  useEffect(() => {
    let active = true;
    const loadUnreadCount = async () => {
      const response = await notificationsAPI.getUnreadCount();
      const count = Number((response.data as { unreadCount?: number } | undefined)?.unreadCount ?? 0);
      if (active && !response.error) setUnreadCount(count);
    };
    loadUnreadCount().catch(() => { if (active) setUnreadCount(0); });
    const handleNotificationsUpdated = () => { loadUnreadCount().catch(() => undefined); };
    const refreshWhenVisible = () => {
      if (!document.hidden) loadUnreadCount().catch(() => undefined);
    };
    window.addEventListener("ebalik-user-notifications-updated", handleNotificationsUpdated);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const refreshInterval = window.setInterval(refreshWhenVisible, 20000);
    return () => {
      active = false;
      window.removeEventListener("ebalik-user-notifications-updated", handleNotificationsUpdated);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(refreshInterval);
    };
  }, []);

  // Close the account menu on outside click / Escape; close the drawer on Escape.
  useEffect(() => {
    if (!accountOpen && !sidebarOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        setSidebarOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen, sidebarOpen]);

  function navigate(p: Page) {
    onNavigate(p);
    setSidebarOpen(false);
    setAccountOpen(false);
  }

  const profileLabel  = user ? `${user.fname} ${user.lname}`.trim() : "Profile";
  const campusIdLabel = user?.campus_id || "Campus ID not set";
  const badge = unreadCount > 99 ? "99+" : String(unreadCount);
  const isReporting = REPORT_PAGES.includes(currentPage);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-gold-500 focus:px-4 focus:py-2 focus:text-[14px] focus:font-semibold focus:text-navy-950"
      >
        Skip to main content
      </a>

      <header className="app-chrome sticky top-0 z-30 w-full shrink-0 border-b border-white/10 pt-[env(safe-area-inset-top)] bg-navy-900/80 text-white shadow-[0_10px_30px_-18px_rgba(5,10,30,0.8)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          {/* Brand */}
          <button type="button" onClick={() => navigate("dashboard")} className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-2" aria-label="E-Balik home">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-white/10 ring-1 ring-white/15">
              <img alt="" className="size-8 object-contain" src={headerUmSeal} />
            </span>
            <span className="hidden text-left leading-tight sm:block lg:hidden xl:block">
              <span className="block font-[family-name:var(--font-heading)] text-[15px] font-semibold tracking-[-0.01em]">E-Balik</span>
              <span className="block text-[11px] font-medium text-gold-300">University of Makati · Lost &amp; Found</span>
            </span>
          </button>

          {/* Desktop nav */}
          <nav className="hidden h-full min-w-0 flex-1 items-stretch gap-0.5 lg:flex" aria-label="Main navigation">
            {NAV_LINKS.map((link) => {
              const active = currentPage === link.page;
              return (
                <button
                  key={link.page}
                  type="button"
                  onClick={() => navigate(link.page)}
                  aria-current={active ? "page" : undefined}
                  aria-label={link.label}
                  title={link.label}
                  className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 text-[14px] font-medium transition-colors duration-150 ${
                    active ? "text-white" : "text-navy-200 hover:text-white"
                  }`}
                >
                  <span className={active ? "text-gold-400" : "text-navy-300"}>{link.icon}</span>
                  {/* Icons only between lg and xl so the bar never overflows into the actions. */}
                  <span className="hidden xl:inline">{link.label}</span>
                  <span className={`absolute inset-x-2 bottom-0 h-[3px] rounded-t-full transition-colors ${active ? "bg-gold-500" : "bg-transparent"}`} aria-hidden="true" />
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
            <button
              type="button"
              onClick={() => navigate("report-item")}
              aria-current={isReporting ? "page" : undefined}
              className={`hidden items-center gap-2 rounded-[10px] px-4 py-2.5 text-[14px] font-semibold transition-colors duration-150 sm:inline-flex ${
                isReporting ? "bg-[linear-gradient(180deg,#e6be76_0%,#d1a153_100%)] text-navy-950 ring-2 ring-gold-200/60" : "bg-[linear-gradient(180deg,#e6be76_0%,#d1a153_100%)] text-navy-950 shadow-[0_1px_0_rgba(255,255,255,0.45)_inset] hover:shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,var(--shadow-glow-gold)]"
              }`}
            >
              <PackagePlus size={16} aria-hidden="true" /> Report item
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={themeLabel}
              title={themeLabel}
              className="flex size-11 items-center justify-center rounded-[10px] text-navy-100 transition-colors hover:bg-white/10 hover:text-gold-300"
            >
              {theme === "dark" ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
            </button>

            <button
              type="button"
              onClick={() => navigate("notifications")}
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
              aria-current={currentPage === "notifications" ? "page" : undefined}
              className={`relative flex size-11 items-center justify-center rounded-[10px] transition-colors ${
                currentPage === "notifications" ? "bg-white/15" : "hover:bg-white/10"
              }`}
            >
              <Bell size={19} className="text-navy-100" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-navy-800" aria-hidden="true">
                  {badge}
                </span>
              )}
            </button>

            {/* Account menu */}
            <div className="relative hidden lg:block" ref={accountRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((open) => !open)}
                className={`flex items-center gap-2 rounded-[10px] py-1.5 pl-1.5 pr-2 transition-colors ${accountOpen || currentPage === "profile" ? "bg-white/15" : "hover:bg-white/10"}`}
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-gold-500 text-[13px] font-bold text-navy-950">{initials(user)}</span>
                <span className="hidden max-w-[140px] truncate text-[14px] font-medium xl:block">{user?.fname || "Account"}</span>
                <ChevronDown size={15} className={`text-navy-200 transition-transform ${accountOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {accountOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-xl border border-line bg-white text-ink shadow-raised"
                  >
                    <div className="border-b border-line px-4 py-3">
                      <p className="truncate text-[14px] font-semibold">{profileLabel}</p>
                      <p className="truncate text-[13px] text-ink-muted">{user?.email}</p>
                      <p className="mt-1 font-mono text-[12px] text-gold-700">{campusIdLabel}</p>
                    </div>
                    <div className="p-1.5">
                      <button type="button" role="menuitem" onClick={() => navigate("profile")} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] font-medium text-ink-soft hover:bg-navy-50">
                        <UserRound size={16} className="text-navy-500" aria-hidden="true" /> Profile &amp; verification
                      </button>
                      <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onLogout(); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] font-medium text-rose-700 hover:bg-rose-50">
                        <LogOut size={16} aria-hidden="true" /> Log out
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button
              type="button"
              className="flex size-11 items-center justify-center rounded-[10px] text-white transition-colors hover:bg-white/10 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              aria-expanded={sidebarOpen}
            >
              <Menu size={22} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile drawer ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="sidebar-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 flex lg:hidden"
          >
            <div className="absolute inset-0 bg-navy-950/55 backdrop-blur-[3px]" onClick={() => setSidebarOpen(false)} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Main menu"
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "spring", stiffness: 420, damping: 38 }}
              className="relative z-50 flex h-full w-[300px] max-w-[85vw] flex-col bg-navy-900 text-white shadow-overlay dark:bg-[linear-gradient(180deg,#0e162e,#070c19)]"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-10 items-center justify-center rounded-[10px] bg-white/10 ring-1 ring-white/15">
                    <img alt="" className="size-8 object-contain" src={headerUmSeal} />
                  </span>
                  <span className="leading-tight">
                    <span className="block font-[family-name:var(--font-heading)] text-[15px] font-semibold">E-Balik</span>
                    <span className="block text-[11px] text-gold-300">University of Makati</span>
                  </span>
                </div>
                <button type="button" onClick={() => setSidebarOpen(false)} className="flex size-11 items-center justify-center rounded-[10px] text-navy-200 hover:bg-white/10 hover:text-white" aria-label="Close menu">
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              <div className="px-4 pt-4">
                <button type="button" onClick={() => navigate("report-item")} className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-gold-500 px-4 py-3 text-[15px] font-semibold text-navy-950 hover:bg-gold-400">
                  <PackagePlus size={17} aria-hidden="true" /> Report an item
                </button>
              </div>

              <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3" aria-label="Main navigation">
                {[...NAV_LINKS, { label: "Notifications", page: "notifications" as Page, icon: <Bell size={16} aria-hidden="true" /> }].map((link) => {
                  const active = currentPage === link.page;
                  return (
                    <button
                      key={link.page}
                      type="button"
                      onClick={() => navigate(link.page)}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 text-left text-[15px] font-medium transition-colors ${
                        active ? "bg-white/12 text-white shadow-[inset_3px_0_0_var(--color-gold-500)]" : "text-navy-200 hover:bg-white/[0.06] hover:text-white"
                      }`}
                    >
                      <span className={active ? "text-gold-400" : "text-navy-300"}>{link.icon}</span>
                      <span className="flex-1">{link.label}</span>
                      {link.page === "notifications" && unreadCount > 0 && (
                        <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[12px] font-bold">{badge}</span>
                      )}
                    </button>
                  );
                })}
              </nav>

              <div className="border-t border-white/10 p-3">
                <button type="button" onClick={() => navigate("profile")} className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-white/[0.06]">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-gold-500 text-[13px] font-bold text-navy-950">{initials(user)}</span>
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-[14px] font-medium">{profileLabel}</span>
                    <span className="block font-mono text-[12px] text-gold-300">{campusIdLabel}</span>
                  </span>
                </button>
                <button type="button" onClick={toggleTheme} className="mt-1 flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium text-navy-100 hover:bg-white/[0.06]">
                  {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />} {theme === "dark" ? "Light mode" : "Dark mode"}
                </button>
                <button type="button" onClick={onLogout} className="mt-1 flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium text-rose-300 hover:bg-rose-500/10">
                  <LogOut size={16} aria-hidden="true" /> Log out
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
