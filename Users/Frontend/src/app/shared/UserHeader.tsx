import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, ChevronDown, ClipboardCheck, KeyRound, Files, Gavel, GitCompareArrows, LayoutDashboard, LibraryBig, LogOut, Menu, Moon, PackagePlus, QrCode, Sun, UserRound, X } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
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
  { label: "Smart Tags",   page: "my-tags",      icon: <QrCode size={16} aria-hidden="true" /> },
];

const REPORT_PAGES: Page[] = ["report-item", "found-item", "missing-item"];

const CONSOLE_LEVELS = ["guard", "admin", "super_admin"];

/** Open the staff console (the guard's Release desk, or the admin console) with the same sign-in. */
function openStaffConsole() {
  const token = localStorage.getItem("ebalik_token");
  const stored = localStorage.getItem("ebalik_user");
  if (token && stored) {
    localStorage.setItem("ebalik_admin_token", token);
    localStorage.setItem("ebalik_admin_user", stored);
  }
  window.location.assign(import.meta.env.VITE_ADMIN_URL || "/admin/");
}

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
  const [scrolled, setScrolled] = useState(false);
  const reduced = useReducedMotion();
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

  // The bar gets a touch more opaque and casts a deeper shadow once content scrolls underneath it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
  const level = String(user?.access_level || "").toLowerCase();
  const consoleLabel = !CONSOLE_LEVELS.includes(level) ? "" : level === "guard" ? "Release desk" : "Admin console";
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

      <header
        className={`app-chrome sticky top-0 z-30 w-full shrink-0 border-b pt-[env(safe-area-inset-top)] text-white backdrop-blur-2xl backdrop-saturate-150 transition-[background-color,box-shadow,border-color] duration-300 ${
          scrolled
            ? "border-white/15 bg-navy-900/90 shadow-[0_16px_40px_-20px_rgba(5,10,30,0.95)]"
            : "border-white/10 bg-navy-900/70 shadow-[0_10px_30px_-22px_rgba(5,10,30,0.8)]"
        }`}
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)]" aria-hidden="true" />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.6),transparent)]" aria-hidden="true" />
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
          {/* Brand */}
          <button type="button" onClick={() => navigate("dashboard")} className="group flex shrink-0 items-center gap-2.5 rounded-xl py-1 pr-2" aria-label="E-Balik home">
            <span className="flex size-10 items-center justify-center rounded-[11px] bg-white/10 ring-1 ring-white/15 transition-[box-shadow,transform] duration-300 group-hover:scale-105 group-hover:ring-gold-400/60 group-hover:shadow-[0_0_18px_-2px_rgba(209,161,83,0.55)]">
              <img decoding="async" alt="" className="size-8 object-contain" src={headerUmSeal} />
            </span>
            <span className="hidden text-left leading-tight sm:block lg:hidden 2xl:block">
              <span className="block font-[family-name:var(--font-heading)] text-[15px] font-semibold tracking-[-0.01em]">E-Balik</span>
              <span className="block whitespace-nowrap text-[11px] font-medium text-gold-300">University of Makati · Lost &amp; Found</span>
            </span>
          </button>

          {/* Desktop nav: a glass capsule with one gold-lit active pill that glides between links. Icons only below xl so it never crowds the actions. */}
          <nav className="hidden min-w-0 flex-1 justify-center lg:flex" aria-label="Main navigation">
            <ul className="flex items-center gap-0.5 rounded-2xl border border-white/10 bg-white/[0.045] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-md">
              {NAV_LINKS.map((link) => {
                const active = currentPage === link.page;
                return (
                  <li key={link.page}>
                    <button
                      type="button"
                      onClick={() => navigate(link.page)}
                      aria-current={active ? "page" : undefined}
                      aria-label={link.label}
                      title={link.label}
                      className={`group relative flex h-10 items-center whitespace-nowrap rounded-xl px-3 text-[14px] font-medium transition-[color,background-color] duration-200 ${
                        active ? "text-white" : "text-navy-200 hover:bg-white/[0.07] hover:text-white"
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="user-nav-active"
                          className="absolute inset-0 rounded-xl bg-white/[0.13] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_8px_18px_-10px_rgba(0,0,0,0.7)] ring-1 ring-white/15"
                          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
                        />
                      )}
                      {active && <span className="absolute inset-x-0 bottom-[3px] mx-auto h-[2px] w-5 rounded-full bg-gold-400 shadow-[0_0_8px_rgba(209,161,83,0.9)]" aria-hidden="true" />}
                      <span className="relative flex items-center gap-1.5">
                        <span className={`transition-[color,transform] duration-200 ${active ? "text-gold-400" : "text-navy-300 group-hover:-translate-y-px group-hover:text-gold-300"}`}>{link.icon}</span>
                        <span className="hidden xl:inline">{link.label}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
            <button
              type="button"
              onClick={() => navigate("report-item")}
              aria-current={isReporting ? "page" : undefined}
              className={`hidden items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold transition-[transform,box-shadow] duration-200 sm:inline-flex ${
                isReporting ? "bg-[linear-gradient(180deg,#e6be76_0%,#d1a153_100%)] text-navy-950 ring-2 ring-gold-200/60" : "bg-[linear-gradient(180deg,#e6be76_0%,#d1a153_100%)] text-navy-950 shadow-[0_1px_0_rgba(255,255,255,0.45)_inset] hover:-translate-y-px hover:shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,var(--shadow-glow-gold)] active:translate-y-0 active:scale-[0.98]"
              }`}
            >
              <PackagePlus size={16} aria-hidden="true" /> Report item
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={themeLabel}
              title={themeLabel}
              className="flex size-11 items-center justify-center rounded-xl text-navy-100 transition-[background-color,color,transform] duration-200 hover:bg-white/10 hover:text-gold-300 active:scale-90"
            >
              {theme === "dark" ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
            </button>

            <button
              type="button"
              onClick={() => navigate("notifications")}
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
              aria-current={currentPage === "notifications" ? "page" : undefined}
              className={`group relative flex size-11 items-center justify-center rounded-xl transition-[background-color,transform] duration-200 active:scale-90 ${
                currentPage === "notifications" ? "bg-white/15 ring-1 ring-white/15" : "hover:bg-white/10"
              }`}
            >
              <Bell size={19} className="text-navy-100 transition-colors group-hover:text-gold-300" aria-hidden="true" />
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
                className={`flex items-center gap-2 rounded-xl border py-1.5 pl-1.5 pr-2 transition-[background-color,border-color] duration-200 ${accountOpen || currentPage === "profile" ? "border-white/15 bg-white/15" : "border-transparent hover:border-white/10 hover:bg-white/10"}`}
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-gold-500 text-[13px] font-bold text-navy-950">{initials(user)}</span>
                <span className="sr-only">{user?.fname || "Account"}</span>
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
                    className="absolute right-0 top-[calc(100%+10px)] z-50 w-64 overflow-hidden rounded-2xl border border-line bg-white/95 text-ink shadow-raised backdrop-blur-xl"
                  >
                    <div className="border-b border-line px-4 py-3">
                      <p className="truncate text-[14px] font-semibold">{profileLabel}</p>
                      <p className="truncate text-[13px] text-ink-muted">{user?.email}</p>
                      <p className="mt-1 font-mono text-[12px] text-gold-700">{campusIdLabel}</p>
                    </div>
                    <div className="p-1.5">
                      {consoleLabel && (
                        <button type="button" role="menuitem" onClick={openStaffConsole} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] font-medium text-ink-soft hover:bg-navy-50">
                          <KeyRound size={16} className="text-navy-500" aria-hidden="true" /> {consoleLabel}
                        </button>
                      )}
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
              className="flex size-11 items-center justify-center rounded-xl text-white transition-[background-color,transform] duration-200 hover:bg-white/10 active:scale-90 lg:hidden"
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
            className="fixed inset-0 z-[55] flex lg:hidden"
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
              className="relative z-50 flex h-[100dvh] w-[300px] max-w-[85vw] flex-col overflow-hidden border-r border-white/10 bg-[linear-gradient(180deg,#1b2c58_0%,#121f42_100%)] text-white shadow-overlay before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-40 before:bg-[radial-gradient(120%_100%_at_0%_0%,rgba(209,161,83,0.16),transparent_70%)] dark:bg-[linear-gradient(180deg,#0e162e,#070c19)]"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-10 items-center justify-center rounded-[10px] bg-white/10 ring-1 ring-white/15">
                    <img decoding="async" alt="" className="size-8 object-contain" src={headerUmSeal} />
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

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
              <div className="px-4 pt-4">
                <button type="button" onClick={() => navigate("report-item")} className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-gold-500 px-4 py-3 text-[15px] font-semibold text-navy-950 hover:bg-gold-400">
                  <PackagePlus size={17} aria-hidden="true" /> Report an item
                </button>
              </div>

              <nav className="flex flex-col gap-0.5 p-3" aria-label="Main navigation">
                {[...NAV_LINKS, { label: "Notifications", page: "notifications" as Page, icon: <Bell size={16} aria-hidden="true" /> }].map((link) => {
                  const active = currentPage === link.page;
                  return (
                    <button
                      key={link.page}
                      type="button"
                      onClick={() => navigate(link.page)}
                      aria-current={active ? "page" : undefined}
                      className={`group flex min-h-[48px] items-center gap-3 rounded-xl px-2 text-left text-[15px] font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.99] ${
                        active ? "bg-white/[0.11] text-white ring-1 ring-white/10" : "text-navy-200 hover:translate-x-0.5 hover:bg-white/[0.06] hover:text-white"
                      }`}
                    >
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${active ? "bg-[linear-gradient(180deg,#ecc787,#d1a153)] text-navy-950" : "bg-white/[0.06] text-navy-300 group-hover:text-gold-300"}`}>{link.icon}</span>
                      <span className="flex-1">{link.label}</span>
                      {link.page === "notifications" && unreadCount > 0 && (
                        <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[12px] font-bold">{badge}</span>
                      )}
                    </button>
                  );
                })}
              </nav>

              <div className="mt-auto border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <button type="button" onClick={() => navigate("profile")} className="flex w-full items-center gap-3 rounded-xl bg-white/[0.05] px-3 py-2.5 text-left ring-1 ring-white/10 transition-colors hover:bg-white/[0.09]">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-gold-500 text-[13px] font-bold text-navy-950">{initials(user)}</span>
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-[14px] font-medium">{profileLabel}</span>
                    <span className="block font-mono text-[12px] text-gold-300">{campusIdLabel}</span>
                  </span>
                </button>
                {consoleLabel && (
                  <button type="button" onClick={openStaffConsole} className="mt-1 flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium text-gold-300 hover:bg-white/[0.06]">
                    <KeyRound size={16} aria-hidden="true" /> {consoleLabel}
                  </button>
                )}
                <button type="button" onClick={toggleTheme} className="mt-1 flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium text-navy-100 hover:bg-white/[0.06]">
                  {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />} {theme === "dark" ? "Light mode" : "Dark mode"}
                </button>
                <button type="button" onClick={onLogout} className="mt-1 flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium text-[#fda4af] hover:bg-rose-500/10">
                  <LogOut size={16} aria-hidden="true" /> Log out
                </button>
              </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
