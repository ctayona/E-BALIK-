import { lazy, Suspense, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import AnnouncementBanner from "./components/AnnouncementBanner";
import { AdminCardGridSkeleton, AdminMetricSkeleton, AdminTableSkeleton, SkeletonBlock } from "./components/LoadingSkeleton";
import { getUnreadNotificationCount } from "./utils/notificationsStore";
import { AdminUser, API_URL, clearAdminSession, fetchAdminNavBadges, getStoredAdmin } from "./utils/api";
import { SESSION_NOTICE_KEY, startSessionGuard, watchForExpiredSessions, type SessionEndReason } from "./utils/sessionGuard";
import InfoModalHost from "./components/info-modal/InfoModalHost";
import { showInfoModal } from "./components/info-modal/infoModalStore";
import { useT, tr } from "./utils/preferences";
import type { StringKey } from "./i18n/strings";
import type { ReportsTab } from "./pages/reports/Reports";

const Dashboard = lazy(() => import("./pages/dashboard/Dashboard"));
const Reports = lazy(() => import("./pages/reports/Reports"));
const ReleaseDesk = lazy(() => import("./pages/guard-desk/ReleaseDesk"));
const AIMatching = lazy(() => import("./pages/ai-matching/AIMatching"));
const Auctions = lazy(() => import("./pages/auctions/Auctions"));
const SmartTags = lazy(() => import("./pages/smart-tags/SmartTags"));
const ClaimsVerification = lazy(() => import("./pages/claims-verification/ClaimsVerification"));
const ChainOfCustody = lazy(() => import("./pages/chain-of-custody/ChainOfCustody"));
const Users = lazy(() => import("./pages/users/Users"));
const ReportsAnalytics = lazy(() => import("./pages/reports-analytics/ReportsAnalytics"));
const Notifications = lazy(() => import("./pages/notifications/Notifications"));
const ActivityLogs = lazy(() => import("./pages/activity-logs/ActivityLogs"));
const AdminProfile = lazy(() => import("./pages/admin-profile/AdminProfile"));
const SystemControl = lazy(() => import("./pages/system-control/SystemControl"));
const GuardDesk = lazy(() => import("./pages/guard-desk/GuardDesk"));
const RecycleBin = lazy(() => import("./pages/recycle-bin/RecycleBin"));

type Page = "dashboard" | "report-hub" | "release-desk" | "ai-matching" | "auctions" | "smart-tags" | "claims" | "chain-of-custody" | "users" | "reports" | "notifications" | "activity-logs" | "system-control" | "recycle-bin" | "admin-profile";

const PAGE_META: Record<Page, StringKey> = {
  "dashboard": "nav.dashboard",
  "report-hub": "nav.reportsHub",
  "release-desk": "nav.releaseDesk",
  "ai-matching": "nav.aiMatching",
  "auctions": "nav.auctions",
  "smart-tags": "nav.smartTags",
  "claims": "nav.claims",
  "chain-of-custody": "nav.custody",
  "users": "nav.users",
  "reports": "nav.reports",
  "notifications": "nav.notifications",
  "activity-logs": "nav.activityLogs",
  "system-control": "nav.systemControl",
  "recycle-bin": "nav.recycleBin",
  "admin-profile": "nav.profile",
};

const ADMIN_PAGE_STORAGE_KEY = "ebalik_admin_last_page";
const REPORT_TAB_STORAGE_KEY = "ebalik_admin_reports_tab";

/** Places other screens (and old bookmarks) can ask for. The lost, found and custody lists now live on one Reports page. */
type NavTarget = Page | "lost-items" | "found-items" | "items-in-custody";
const REPORT_TAB_FOR: Partial<Record<NavTarget, ReportsTab>> = { "lost-items": "lost", "found-items": "found", "items-in-custody": "custody" };

export default function App() {
  const [user, setUser] = useState<AdminUser | null>(() => getStoredAdmin());
  const [page, setPage] = useState<Page>(() => {
    const stored = localStorage.getItem(ADMIN_PAGE_STORAGE_KEY) as NavTarget | null;
    if (stored && REPORT_TAB_FOR[stored]) return "report-hub";
    return stored && PAGE_META[stored as Page] ? stored as Page : "dashboard";
  });
  const [reportTab, setReportTab] = useState<ReportsTab>(() => {
    const stored = localStorage.getItem(ADMIN_PAGE_STORAGE_KEY) as NavTarget | null;
    const saved = localStorage.getItem(REPORT_TAB_STORAGE_KEY);
    return (stored && REPORT_TAB_FOR[stored]) || (saved === "found" || saved === "custody" ? saved : "lost");
  });
  const [notifCount, setNotifCount] = useState<number>(() => getUnreadNotificationCount());
  // Numbers on the menu: how many items wait for an approval or verification on each page.
  const [badges, setBadges] = useState<Record<string, number>>({});
  const t = useT();

  const handleLogout = () => {
    clearAdminSession();
    localStorage.removeItem("ebalik_admin_notifications");
    showInfoModal({ variant: "info", title: "Signed out", message: "You have been signed out of the E-Balik admin console." });
    window.location.assign("/");
  };

  useEffect(() => {
    if (!user) {
      clearAdminSession();
      localStorage.removeItem("ebalik_admin_notifications");
      window.location.replace("/");
    }
  }, [user]);

  // Keep the menu badges fresh: on load, every minute, when the tab comes back, after a page change and when a page says it changed something.
  useEffect(() => {
    if (!user || user.access_level === "guard") return undefined;
    let active = true;
    const refresh = () => { void fetchAdminNavBadges().then((next) => { if (active) setBadges(next); }).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("ebalik-claims-updated", refresh);
    window.addEventListener("ebalik-account-verifications-updated", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("ebalik-claims-updated", refresh);
      window.removeEventListener("ebalik-account-verifications-updated", refresh);
    };
  }, [user, page]);

  // End an admin session that expired or sat idle (rules in utils/sessionGuard.ts): clear every copy of the sign-in, then send the
  // person to the public site, which tells them why. This is what stops last night's admin session working this morning.
  useEffect(() => {
    if (!user) return undefined;
    const end = (reason: SessionEndReason) => {
      try { localStorage.setItem(SESSION_NOTICE_KEY, reason); } catch { /* storage blocked */ }
      clearAdminSession();
      localStorage.removeItem("ebalik_admin_notifications");
      window.location.replace("/");
    };
    const options = { tokenKey: "ebalik_admin_token", onEnd: end };
    const stopGuard = startSessionGuard(options);
    const stopWatching = watchForExpiredSessions({ ...options, apiUrl: API_URL });
    return () => { stopGuard(); stopWatching(); };
  }, [user]);

  useEffect(() => {
    const syncUnreadCount = () => setNotifCount(getUnreadNotificationCount());
    syncUnreadCount();
    window.addEventListener("ebalik-notifications-updated", syncUnreadCount);
    return () => window.removeEventListener("ebalik-notifications-updated", syncUnreadCount);
  }, []);

  useEffect(() => {
    localStorage.setItem(ADMIN_PAGE_STORAGE_KEY, page);
  }, [page]);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 text-center">
        <div className="rounded-2xl border border-line bg-white p-8 max-w-sm w-full">
          <div className="w-12 h-12 rounded-xl bg-[#fef2f2] flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" className="text-red-500"><path d="M12 9v4m0 4h.01M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </div>
          <p className="text-base font-bold text-slate-900">{tr("Session Expired")}</p>
          <p className="mt-2 text-sm text-slate-500">{tr("Redirecting you back to login…")}</p>
        </div>
      </div>
    );
  }

  // A guard sees one screen, the release desk. The server refuses every other admin request from a guard as well.
  if (user.access_level === "guard") {
    return (
      <>
        <Suspense fallback={<AdminPageSkeleton />}><GuardDesk user={user} onLogout={handleLogout} /></Suspense>
        <InfoModalHost />
      </>
    );
  }

  const navigate = (target: NavTarget) => {
    const tab = REPORT_TAB_FOR[target];
    const next: Page = tab ? "report-hub" : target as Page;
    if (tab) changeReportTab(tab);
    setPage(next);
    localStorage.setItem(ADMIN_PAGE_STORAGE_KEY, next);
  };
  const changeReportTab = (tab: ReportsTab) => {
    setReportTab(tab);
    localStorage.setItem(REPORT_TAB_STORAGE_KEY, tab);
  };

  const pageTitle = t(PAGE_META[page]);

  const renderPage = () => {
    switch (page) {
      case "dashboard": return <Dashboard onNavigate={(target) => navigate(target)} />;
      case "report-hub": return <Reports tab={reportTab} onTabChange={changeReportTab} onNavigate={(target) => navigate(target)} />;
      case "release-desk": return <ReleaseDesk />;
      case "ai-matching": return <AIMatching />;
      case "auctions": return <Auctions />;
      case "smart-tags": return <SmartTags />;
      case "claims": return <ClaimsVerification />;
      case "chain-of-custody": return <ChainOfCustody />;
      case "users": return <Users />;
      case "reports": return <ReportsAnalytics />;
      case "notifications": return <Notifications />;
      case "activity-logs": return <ActivityLogs />;
      case "system-control": return user.access_level === "super_admin" ? <SystemControl /> : <Dashboard onNavigate={(target) => navigate(target)} />;
      case "recycle-bin": return user.access_level === "super_admin" ? <RecycleBin /> : <Dashboard onNavigate={(target) => navigate(target)} />;
      case "admin-profile": return <AdminProfile />;
      default: return <Dashboard onNavigate={(target) => navigate(target)} />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentPage={page}
        onNavigate={navigate}
        notifCount={notifCount}
        badges={badges}
        user={user}
        onLogout={handleLogout}
      />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
        <AnnouncementBanner />
        <Header
          breadcrumb={[t("nav.home"), pageTitle]}
          title={pageTitle}
          notifCount={notifCount}
          onNotifClick={() => navigate("notifications")}
          onProfileClick={() => navigate("admin-profile")}
          user={user}
          onLogout={handleLogout}
        />
        <main className="app-main min-w-0 flex-1 overflow-y-auto">
          <Suspense fallback={<AdminPageSkeleton />}>
            {renderPage()}
          </Suspense>
        </main>
      </div>
      <InfoModalHost />
    </div>
  );
}

function AdminPageSkeleton() {
  return (
    <div className="space-y-5 p-4 sm:p-6" aria-busy="true">
      <div><SkeletonBlock className="mb-2 h-7 w-52" /><SkeletonBlock className="h-4 w-64" /></div>
      <AdminMetricSkeleton count={4} />
      <div className="grid gap-4 xl:grid-cols-2"><AdminCardGridSkeleton count={2} /><AdminTableSkeleton columns={5} rows={4} /></div>
    </div>
  );
}
