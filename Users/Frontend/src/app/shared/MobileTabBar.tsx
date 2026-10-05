import { Files, GitCompareArrows, LayoutDashboard, LibraryBig, Plus } from "lucide-react";
import type { Page } from "@/app/types";

const REPORT_PAGES: Page[] = ["report-item", "found-item", "missing-item"];

const TABS: { label: string; page: Page; Icon: typeof Files }[] = [
  { label: "Home", page: "dashboard", Icon: LayoutDashboard },
  { label: "Browse", page: "browse-items", Icon: LibraryBig },
  { label: "Matches", page: "matches", Icon: GitCompareArrows },
  { label: "Reports", page: "my-reports", Icon: Files },
];

/** Thumb-reach bottom navigation for phones (hidden from lg up). Respects the home-indicator safe area. */
export default function MobileTabBar({ currentPage, onNavigate }: { currentPage: Page; onNavigate: (page: Page) => void }) {
  const reporting = REPORT_PAGES.includes(currentPage);
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  const tab = ({ label, page, Icon }: (typeof TABS)[number]) => {
    const active = currentPage === page;
    return (
      <button
        key={page}
        type="button"
        onClick={() => onNavigate(page)}
        aria-current={active ? "page" : undefined}
        className="group relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold"
      >
        <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-[background-color,color] duration-200 ${active ? "bg-white/15 text-gold-300" : "text-navy-200 group-active:bg-white/10"}`}>
          <Icon size={21} strokeWidth={active ? 2.3 : 1.9} aria-hidden="true" />
        </span>
        <span className={active ? "text-white" : "text-navy-200"}>{label}</span>
      </button>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="app-chrome fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-navy-900/85 pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-12px_30px_-16px_rgba(5,10,30,0.7)] backdrop-blur-xl backdrop-saturate-150 lg:hidden print:hidden"
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(209,161,83,0.55),transparent)]" aria-hidden="true" />
      <div className="mx-auto flex max-w-[560px] items-stretch px-2">
        {left.map(tab)}
        <div className="flex flex-1 items-start justify-center">
          <button
            type="button"
            onClick={() => onNavigate("report-item")}
            aria-label="Report an item"
            aria-current={reporting ? "page" : undefined}
            className={`-mt-5 flex size-[58px] items-center justify-center rounded-[20px] bg-[linear-gradient(160deg,#f3dcab_0%,#d1a153_60%,#b9873a_100%)] text-navy-950 shadow-[0_12px_28px_-8px_rgba(209,161,83,0.85),inset_0_1px_0_rgba(255,255,255,0.6)] ring-4 ring-navy-900 transition-transform active:scale-95 ${reporting ? "ring-gold-200/40" : ""}`}
          >
            <Plus size={26} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
        {right.map(tab)}
      </div>
    </nav>
  );
}
