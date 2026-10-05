import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { NavigationOptions, Page } from "@/app/types";
import { PanelSkeleton, ReportGridSkeleton } from "@/app/shared/LoadingSkeleton";
const Landing = lazy(() => import("@/app/pages/home/Landing"));
const Dashboard = lazy(() => import("@/app/pages/dashboard/Dashboard"));
const FoundItem = lazy(() => import("@/app/pages/found-item/FoundItem"));
const MissingItem = lazy(() => import("@/app/pages/missing-item/MissingItem"));
const Claim = lazy(() => import("@/app/pages/claim/Claim"));
const Profile = lazy(() => import("@/app/pages/profile/Profile"));
const MyReports = lazy(() => import("@/app/pages/my-reports/MyReports"));
const Matches = lazy(() => import("@/app/pages/matches/Matches"));
const BrowseItems = lazy(() => import("@/app/pages/browse-items/BrowseItems"));
const ReportItem = lazy(() => import("@/app/pages/report-item/ReportItem"));
const Notifications = lazy(() => import("@/app/pages/notifications/Notifications"));
const AuctionHall = lazy(() => import("@/app/pages/auction-hall/AuctionHall"));
import UserHeader from "@/app/shared/UserHeader";
import MobileTabBar from "@/app/shared/MobileTabBar";
import InfoModalHost from "@/app/shared/info-modal/InfoModalHost";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { useAuth } from "@/app/utils/useAuth";
import { authUtils } from "@/app/utils/api";
import MaintenanceScreen from "@/app/shared/system/MaintenanceScreen";
import { SYSTEM_EVENT, isStaff, useSystemStatus, type SystemEventDetail } from "@/app/utils/system";

const USER_PAGE_STORAGE_KEY = "ebalik_user_last_page";
const USER_NAVIGATION_OPTIONS_KEY = "ebalik_user_navigation_options";
const AUTHENTICATED_PAGES: Page[] = [
  "dashboard", "report-item", "found-item", "missing-item", "my-reports",
  "matches", "browse-items", "claim", "auction-hall", "profile", "notifications",
];

export default function App() {
  const { user, isAuthenticated, logout, refreshProfile } = useAuth();
  const [page, setPage] = useState<Page>("home");
  const [navigationOptions, setNavigationOptions] = useState<NavigationOptions>(() => {
    if (!authUtils.getToken() || !authUtils.getUserData()) return {};
    try {
      return JSON.parse(sessionStorage.getItem(USER_NAVIGATION_OPTIONS_KEY) || "{}") as NavigationOptions;
    } catch {
      return {};
    }
  });
  const currentUser = user ?? authUtils.getUserData();
  const system = useSystemStatus();
  const lastSystemEvent = useRef({ code: "", at: 0 });

  useEffect(() => {
    if (!isAuthenticated) {
      setPage("home");
      return;
    }

    setPage((currentPage) => {
      if (currentPage !== "home") return currentPage;
      const storedPage = localStorage.getItem(USER_PAGE_STORAGE_KEY) as Page | null;
      return storedPage && AUTHENTICATED_PAGES.includes(storedPage) ? storedPage : "dashboard";
    });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || page === "home") return;
    localStorage.setItem(USER_PAGE_STORAGE_KEY, page);
    sessionStorage.setItem(USER_NAVIGATION_OPTIONS_KEY, JSON.stringify(navigationOptions));
  }, [isAuthenticated, page, navigationOptions]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshProfile();
    };
    void refreshProfile();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const refreshInterval = window.setInterval(refresh, 20000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(refreshInterval);
    };
  }, [isAuthenticated, refreshProfile]);

  // Server-side blocks (revoked session, suspension, unverified account) are handled once, here, for every page.
  useEffect(() => {
    const onSystemEvent = (event: Event) => {
      const detail = (event as CustomEvent<SystemEventDetail>).detail;
      if (!detail || detail.code === "maintenance") return;
      const now = Date.now();
      if (lastSystemEvent.current.code === detail.code && now - lastSystemEvent.current.at < 4000) return;
      lastSystemEvent.current = { code: detail.code, at: now };

      if (detail.code === "verification_required") {
        showInfoModal({
          variant: "warning",
          title: "Verify your account first",
          message: detail.message || "Only verified accounts can report items, file claims or bid.",
          details: ["Open My Profile and upload a school or government ID.", "An administrator reviews it and assigns your role."],
        });
        void refreshProfile();
        return;
      }
      logout();
      localStorage.removeItem(USER_PAGE_STORAGE_KEY);
      sessionStorage.removeItem(USER_NAVIGATION_OPTIONS_KEY);
      setNavigationOptions({});
      setPage("home");
      if (detail.code === "suspended") {
        showInfoModal({ variant: "error", title: "Account suspended", message: detail.message || "Your account is suspended. Contact the Lost and Found Office for help.", autoCloseMs: null });
      } else {
        showInfoModal({ variant: "info", title: "You were signed out", message: "An administrator ended all sessions for security. Sign in again to continue." });
      }
    };
    window.addEventListener(SYSTEM_EVENT, onSystemEvent);
    return () => window.removeEventListener(SYSTEM_EVENT, onSystemEvent);
  }, [logout, refreshProfile]);

  function handleLoginSuccess() {
    setPage("dashboard");
  }

  function handleNavigate(nextPage: Page, options: NavigationOptions = {}) {
    setNavigationOptions(options);
    setPage(nextPage);
  }

  function handleLogout() {
    logout();
    localStorage.removeItem(USER_PAGE_STORAGE_KEY);
    sessionStorage.removeItem(USER_NAVIGATION_OPTIONS_KEY);
    setNavigationOptions({});
    setPage("home");
    showInfoModal({ variant: "info", title: "Signed out", message: "You have been signed out of E-Balik. Sign in again any time to continue." });
  }

  if (system.maintenance && !isStaff(currentUser)) {
    return (
      <>
        <MaintenanceScreen status={system} onRefresh={system.refresh} onStaffSignedIn={handleLoginSuccess} />
        <InfoModalHost />
      </>
    );
  }

  if (!isAuthenticated && page === "home") {
    return (
      <>
        <Suspense fallback={<LandingSkeleton />}><Landing onLoginSuccess={handleLoginSuccess} /></Suspense>
        <InfoModalHost />
      </>
    );
  }

  return (
    <div className="app-canvas min-h-screen flex flex-col">
      <UserHeader
        currentPage={page}
        onNavigate={handleNavigate}
        user={currentUser}
        onLogout={handleLogout}
      />
      <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col pb-[calc(76px+env(safe-area-inset-bottom))] outline-none lg:pb-0">
      <Suspense fallback={<AppPageSkeleton />}>
        {page === "dashboard"    && <Dashboard user={currentUser} onNavigate={handleNavigate} />}
        {page === "report-item"  && <ReportItem onNavigate={handleNavigate} />}
        {page === "found-item"   && <FoundItem focused={navigationOptions.mode === "form"} onBack={handleNavigate} />}
        {page === "missing-item" && <MissingItem focused={navigationOptions.mode === "form"} initialSearchTerm={navigationOptions.searchTerm} onBack={handleNavigate} />}
        {page === "my-reports"   && <MyReports onNavigate={handleNavigate} />}
        {page === "matches"      && <Matches initialReportId={navigationOptions.reportId} onNavigate={handleNavigate} />}
        {page === "browse-items" && <BrowseItems onNavigate={handleNavigate} />}
        {page === "claim"        && <Claim foundItemId={navigationOptions.foundItemId} onNavigate={handleNavigate} />}
        {page === "auction-hall" && <AuctionHall onNavigate={handleNavigate} />}
        {page === "notifications" && <Notifications onNavigate={handleNavigate} />}
        {page === "profile"      && <Profile user={currentUser} onNavigate={handleNavigate} />}
      </Suspense>
      </div>
      <MobileTabBar currentPage={page} onNavigate={handleNavigate} />
      <InfoModalHost />
    </div>
  );
}

function AppPageSkeleton() {
  return <main className="min-h-[70vh] p-6 md:p-10"><div className="mx-auto max-w-[1120px] space-y-5"><PanelSkeleton className="h-28" /><ReportGridSkeleton count={4} /></div></main>;
}

function LandingSkeleton() {
  return <main className="app-canvas min-h-screen p-6"><div className="mx-auto max-w-[1100px] space-y-6"><PanelSkeleton className="h-[420px] bg-[#1f3160]" /><ReportGridSkeleton count={4} /></div></main>;
}
