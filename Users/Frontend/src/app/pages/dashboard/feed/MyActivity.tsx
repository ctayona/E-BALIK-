import { CheckCircle2, FileStack, Hourglass, PackagePlus, SearchX, type LucideIcon } from "lucide-react";
import type { Page } from "@/app/types";
import { FEED_CARD } from "./feedStyle";

export interface ActivityCounts {
  found: number;
  missing: number;
  open: number;
  completed: number;
}

const TILES: Array<{ key: keyof ActivityCounts; label: string; icon: LucideIcon; tone: string }> = [
  { key: "found", label: "Found", icon: PackagePlus, tone: "bg-gold-50 text-gold-700 ring-gold-200/80" },
  { key: "missing", label: "Lost", icon: SearchX, tone: "bg-iris-50 text-iris-700 ring-iris-200/80" },
  { key: "open", label: "Open", icon: Hourglass, tone: "bg-frost-100 text-navy-700 ring-line" },
  { key: "completed", label: "Completed", icon: CheckCircle2, tone: "bg-tide-50 text-tide-700 ring-tide-200/80" },
];

/**
 * "Your activity" under the Report an item button: how many reports you posted and how they are doing.
 * `counts` is null while loading (shimmer tiles).
 */
export default function MyActivity({ counts, onNavigate }: { counts: ActivityCounts | null; onNavigate: (page: Page) => void }) {
  const total = counts ? counts.found + counts.missing : 0;
  const share = counts && total > 0 ? Math.round((counts.completed / total) * 100) : 0;
  return (
    <section aria-label="Your activity" className={`${FEED_CARD} p-3.5`}>
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <h2 className="text-[13px] font-semibold text-ink-muted">Your activity</h2>
        <button type="button" onClick={() => onNavigate("my-reports")} className="inline-flex min-h-[28px] items-center gap-1 text-[12.5px] font-semibold text-iris-700 hover:underline">
          <FileStack size={13} aria-hidden="true" />My reports
        </button>
      </div>
      <div className="mt-1 flex items-end gap-2 px-0.5">
        {counts ? (
          <span className="font-[family-name:var(--font-heading)] text-[34px] font-semibold leading-none tabular-nums text-ink">{total}</span>
        ) : (
          <span className="h-8 w-10 animate-pulse rounded-lg bg-frost-100" aria-hidden="true" />
        )}
        <span className="pb-0.5 text-[13px] text-ink-muted">{total === 1 ? "report posted" : "reports posted"}</span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-frost-100" role="img" aria-label={counts ? `${share} percent of your reports are completed` : "Loading"}>
        <div className="h-full rounded-full bg-[linear-gradient(90deg,#d1a153,#e6bd77)] transition-[width] duration-700" style={{ width: `${share}%` }} />
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {TILES.map(({ key, label, icon: Icon, tone }) => (
          <li key={key} className="rounded-xl border border-line bg-frost-50 px-2.5 py-2">
            <span className="flex items-center justify-between">
              <span className="text-[17px] font-semibold leading-5 tabular-nums text-ink">{counts ? counts[key] : "–"}</span>
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ${tone}`} aria-hidden="true"><Icon size={13} /></span>
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-4 text-ink-muted">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
