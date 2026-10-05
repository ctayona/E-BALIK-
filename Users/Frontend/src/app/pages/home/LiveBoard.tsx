import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, MapPin, PackageSearch, SearchX } from "lucide-react";
import { SkeletonBlock } from "@/app/shared/LoadingSkeleton";
import ItemImage, { type GalleryItem } from "@/app/shared/media/ItemImage";
import ItemViewer from "@/app/shared/media/ItemViewer";
import type { PublicBoard } from "@/app/utils/api";
import { CX } from "@/app/utils/clay";

type Tab = "missing" | "found";

function formatDay(value?: string) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** The public "what's on campus right now" board: newest missing reports and found items, visible without logging in. */
export default function LiveBoard({ board, loading, onLogin }: { board: PublicBoard | null; loading: boolean; onLogin: () => void }) {
  const [tab, setTab] = useState<Tab>("missing");
  const [viewIndex, setViewIndex] = useState<number | null>(null);

  const items = useMemo<Record<Tab, GalleryItem[]>>(() => ({
    missing: (board?.missing ?? []).map((item, index): GalleryItem => ({
      id: item.mpost_id || `missing-${index}`, title: item.item_name || "Missing item", kind: "missing", image: item.image_url || undefined,
      category: item.category || undefined, location: item.last_location || "University of Makati campus", date: formatDay(item.last_seen_date || item.created_at),
    })),
    found: (board?.found ?? []).map((item, index): GalleryItem => ({
      id: item.fpost_id || `found-${index}`, title: item.item_name || "Found item", kind: "found", image: item.image_url || undefined,
      category: item.category || undefined, location: item.location || "University of Makati campus", date: formatDay(item.found_date || item.created_at),
    })),
  }), [board]);

  const list = items[tab];
  const counts = board?.counts ?? { missing: 0, found: 0 };
  const tabs: { id: Tab; label: string; icon: typeof SearchX; count: number }[] = [
    { id: "missing", label: "Missing reports", icon: SearchX, count: counts.missing },
    { id: "found", label: "Found items", icon: PackageSearch, count: counts.found },
  ];

  return (
    <section className="flex w-full flex-col items-center gap-10 bg-slate-50 px-8 pb-24 pt-20 md:px-16" aria-labelledby="live-board">
      <div className="max-w-[640px] text-center">
        <span className="mb-3 inline-block text-[13px] font-semibold text-gold-700">Live from campus</span>
        <h2 id="live-board" className="text-[32px] font-semibold text-navy-800 md:text-[38px]" style={{ fontFamily: "var(--font-heading)" }}>See what's lost and found right now</h2>
        <p className="mx-auto mt-3 max-w-[500px] text-[15px] leading-7 text-ink-muted">Recent reports from students and staff, and items waiting at campus security. Spot yours? Log in to claim it or get matched.</p>
      </div>

      <div role="tablist" aria-label="Board" className="inline-flex rounded-2xl border border-line bg-white p-1.5 shadow-card">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition-colors sm:px-5 ${tab === id ? "bg-navy-800 text-white" : "text-ink-soft hover:bg-navy-50"}`}>
            <Icon size={16} aria-hidden="true" /> {label}
            <span className={`min-w-[24px] rounded-full px-1.5 text-center text-[12.5px] tabular-nums ${tab === id ? "bg-white/20" : "bg-frost-100"}`}>{loading ? "…" : count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid w-full max-w-[1140px] grid-cols-2 gap-5 md:grid-cols-4" aria-busy="true" aria-label="Loading recent reports">
          {Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} className="aspect-[4/5] w-full rounded-[22px]" />)}
        </div>
      ) : list.length === 0 ? (
        <p className="max-w-[460px] rounded-[22px] border border-dashed border-line-strong bg-white px-6 py-10 text-center text-[15px] text-ink-muted">
          {tab === "missing" ? "No missing reports right now. If you lose something, report it and we'll watch the found list for you." : "Nothing is in custody right now. New found items appear here as soon as they're turned over to campus security."}
        </p>
      ) : (
        <ul className="grid w-full max-w-[1140px] grid-cols-2 gap-4 sm:gap-5 md:grid-cols-4">
          {list.map((item, index) => (
            <li key={item.id}>
              <button type="button" onClick={() => setViewIndex(index)} aria-label={`${item.title}, ${tab === "missing" ? "missing" : "found"} item`} className="group relative block aspect-[4/5] w-full overflow-hidden rounded-[22px] bg-navy-950 text-left shadow-card transition-[box-shadow,transform] duration-300 ease-out hover:-translate-y-1.5 hover:shadow-raised">
                <ItemImage item={item} size="lg" className="absolute inset-0 h-full w-full" imgClassName="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.08]" />
                <div className="scrim-bottom absolute inset-0" aria-hidden="true" />
                <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-[12px] font-bold ${tab === "missing" ? "bg-rose-600 text-white" : "bg-gold-500 text-navy-950"}`}>{tab === "missing" ? "Missing" : "In custody"}</span>
                <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                  {item.category && <p className="mb-1 truncate text-[12px] font-medium text-gold-200">{item.category}</p>}
                  <p className="truncate font-[family-name:var(--font-heading)] text-[17px] font-semibold">{item.title}</p>
                  <div className="mt-1.5 flex flex-col gap-1 text-[12px] text-navy-100">
                    <span className="flex items-center gap-1.5 truncate"><MapPin size={12} aria-hidden="true" className="shrink-0" />{item.location}</span>
                    {item.date && <span className="flex items-center gap-1.5"><CalendarDays size={12} aria-hidden="true" className="shrink-0" />{item.date}</span>}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <button type="button" onClick={onLogin} className={`${CX.btnGold} min-h-[48px] px-8`}>Report a lost item</button>
        <button type="button" onClick={onLogin} className={`${CX.btnNavy} min-h-[48px] px-8`}>
          {tab === "missing" ? "Log in to see all missing reports" : "Log in to see all found items"} <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>

      {viewIndex !== null && list[viewIndex] && (
        <ItemViewer
          items={list}
          index={viewIndex}
          onIndexChange={setViewIndex}
          onClose={() => setViewIndex(null)}
          note={(item) => <p className="rounded-xl border border-iris-200 bg-iris-50 px-4 py-3 text-[14px] leading-5 text-iris-700">{item.kind === "found" ? "Sign in with your UMak account to claim this item or report one you lost." : "Sign in with your UMak account if you found this, or to report your own lost item."}</p>}
          actions={(item) => (
            <button type="button" onClick={() => { setViewIndex(null); onLogin(); }} className={`${CX.btnGold} w-full`}>
              {item.kind === "found" ? "Log in to claim this item" : "Log in to help find this item"}
            </button>
          )}
        />
      )}
    </section>
  );
}
