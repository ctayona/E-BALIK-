import { lazy, Suspense, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import { AdminCardGridSkeleton, AdminMetricSkeleton, AdminTableSkeleton, SkeletonBlock } from "./components/LoadingSkeleton";
import { getUnreadNotificationCount } from "./utils/notificationsStore";
import { AdminUser, clearAdminSession, getStoredAdmin } from "./utils/api";
import InfoModalHost from "./components/info-modal/InfoModalHost";
import { showInfoModal } from "./components/info-modal/infoModalStore";
import { useT, tr } from "./utils/preferences";
import type { StringKey } from "./i18n/strings";

const Dashboard = lazy(() => import("./pages/dashboard/Dashboard"));
const LostItems = lazy(() => import("./pages/lost-items/LostItems"));
const FoundItems = lazy(() => import("./pages/found-items/FoundItems"));
const AIMatching = lazy(() => import("./pages/ai-matching/AIMatching"));
const Auctions = lazy(() => import("./pages/auctions/Auctions"));
const ClaimsVerification = lazy(() => import("./pages/claims-verification/ClaimsVerification"));
const ChainOfCustody = lazy(() => import("./pages/chain-of-custody/ChainOfCustody"));
const Users = lazy(() => import("./pages/users/Users"));
const ReportsAnalytics = lazy(() => import("./pages/reports-analytics/ReportsAnalytics"));
const Notifications = lazy(() => import("./pages/notifications/Notifications"));
const ActivityLogs = lazy(() => import("./pages/activity-logs/ActivityLogs"));
const AdminProfile = lazy(() => import("./pages/admin-profile/AdminProfile"));

type Page = "dashboard" | "lost-items" | "found-items" | "ai-matching" | "auctions" | "claims" | "chain-of-custody" | "users" | "reports" | "notifications" | "activity-logs" | "admin-profile";

const PAGE_META: Record<Page, StringKey> = {
  "dashboard": "nav.dashboard",
  "lost-items": "nav.lostItems",
  "found-items": "nav.foundItems",
  "ai-matching": "nav.aiMatching",
  "auctions": "nav.auctions",
  "claims": "nav.claims",
  "chain-of-custody": "nav.custody",
  "users": "nav.users",
  "reports": "nav.reports",
  "notifications": "nav.notifications",
  "activity-logs": "nav.activityLogs",
  "admin-profile": "nav.profile",
};

const ADMIN_PAGE_STORAGE_KEY = "ebalik_admin_last_page";

export default function App() {
  const [user, setUser] = useState<AdminUser | null>(() => getStoredAdmin());
  const [page, setPage] = useState<Page>(() => {
    const stored = localStorage.getItem(ADMIN_PAGE_STORAGE_KEY) as Page | null;
    return stored && PAGE_META[stored as Page] ? stored as Page : "dashboard";
  });
  const [notifCount, setNotifCount] = useState<number>(() => getUnreadNotificationCount());
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

  const navigate = (p: Page) => {
    setPage(p);
    localStorage.setItem(ADMIN_PAGE_STORAGE_KEY, p);
  };

  const pageTitle = t(PAGE_META[page]);

  const renderPage = () => {
    switch (page) {
      case "dashboard": return <Dashboard onNavigate={(target) => navigate(target)} />;
      case "lost-items": return <LostItems />;
      case "found-items": return <FoundItems />;
      case "ai-matching": return <AIMatching />;
      case "auctions": return <Auctions />;
      case "claims": return <ClaimsVerification />;
      case "chain-of-custody": return <ChainOfCustody />;
      case "users": return <Users />;
      case "reports": return <ReportsAnalytics />;
      case "notifications": return <Notifications />;
      case "activity-logs": return <ActivityLogs />;
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
        user={user}
        onLogout={handleLogout}
      />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
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
