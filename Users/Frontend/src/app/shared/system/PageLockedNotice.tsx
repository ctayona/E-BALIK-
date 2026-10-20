import { Home, LockKeyhole, RefreshCw } from "lucide-react";
import type { NavigationOptions, Page } from "@/app/types";
import { CX } from "@/app/utils/clay";

const LABELS: Partial<Record<Page, string>> = {
  dashboard: "The home feed", "report-item": "Reporting an item", "found-item": "Reporting a found item", "missing-item": "Reporting a lost item",
  "my-reports": "Managing your reports", matches: "Matching", "browse-items": "Browsing items", claim: "Filing a claim", "auction-hall": "The Auction Hall",
  "my-tags": "Managing Smart Tags", notifications: "The notifications page", profile: "Your profile",
};

/** Shown in place of a page a super administrator locked while fixing it (System control > Page isolation). */
export default function PageLockedNotice({ page, message, onNavigate }: { page: Page; message: string; onNavigate: (page: Page, options?: NavigationOptions) => void }) {
  const label = LABELS[page] ?? "This page";
  return (
    <main className={CX.page}>
      <div className="mx-auto mt-6 w-full max-w-[640px]" role="alert">
        <section className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(140deg,#22366a_0%,#162448_60%,#0e1830_100%)] p-7 text-white shadow-[0_28px_70px_-38px_rgba(14,24,48,0.95)] sm:p-9">
          <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-[radial-gradient(circle,rgba(209,161,83,0.36),transparent_68%)]" />
          <span className="relative flex size-14 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950 shadow-[0_0_0_5px_rgba(255,255,255,0.08)]"><LockKeyhole size={24} aria-hidden="true" /></span>
          <h1 className="relative mt-5 font-[family-name:var(--font-heading)] text-[28px] font-semibold leading-tight sm:text-[32px]">{label} is paused for a moment</h1>
          <p className="relative mt-3 max-w-[52ch] text-[15.5px] leading-7 text-navy-100">{message || "We are fixing something here. It opens again as soon as the work is done. Everything else in E-Balik works as usual."}</p>
          <div className="relative mt-7 flex flex-wrap gap-2.5">
            <button type="button" onClick={() => onNavigate(page === "dashboard" ? "my-reports" : "dashboard")} className={CX.btnGold}><Home size={16} aria-hidden="true" />{page === "dashboard" ? "Go to my reports" : "Go to the home feed"}</button>
            <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-[46px] items-center gap-2 rounded-2xl bg-white/10 px-4 text-[14px] font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15"><RefreshCw size={16} aria-hidden="true" />Check again</button>
          </div>
        </section>
        <p className="mt-4 px-1 text-[13px] leading-5 text-ink-muted">Found something urgent, like an ID or a wallet? Bring it to the nearest OHSO guard post: the office works as usual.</p>
      </div>
    </main>
  );
}
