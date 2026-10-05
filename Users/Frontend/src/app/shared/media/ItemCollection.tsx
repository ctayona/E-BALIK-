import { memo, type ReactNode } from "react";
import { CalendarDays, ChevronRight, MapPin, Search, ShieldCheck } from "lucide-react";
import ItemImage, { type GalleryItem } from "./ItemImage";
import type { ViewMode } from "@/app/shared/view/useViewMode";

type Slot = (item: GalleryItem, index: number) => ReactNode;

/**
 * Renders items as photo tiles or compact list rows — the single, consistent item display used across pages.
 * - `badge`: small element shown on the photo (tile) or beside the title (list), e.g. status or match score.
 * - `extra`: content under the metadata, e.g. a match meter or report counts.
 */
function ItemCollection({
  items,
  mode,
  onOpen,
  badge,
  extra,
  empty,
  showKind = true,
  dense = false,
  label,
}: {
  items: GalleryItem[];
  mode: ViewMode;
  onOpen: (item: GalleryItem, index: number) => void;
  badge?: Slot;
  extra?: Slot;
  empty?: ReactNode;
  showKind?: boolean;
  /** Tighter grid (more columns) for secondary sections. */
  dense?: boolean;
  label?: string;
}) {
  if (items.length === 0) return <>{empty}</>;

  if (mode === "list") {
    return (
      <ul aria-label={label} className="overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-card divide-y divide-line">
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item, index)}
              className="group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-frost-50 sm:gap-4 sm:px-4"
            >
              <ItemImage item={item} size="sm" className="size-16 shrink-0 rounded-2xl sm:size-[72px]" imgClassName="object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {showKind && <KindDot kind={item.kind} />}
                  <span className="truncate text-[15px] font-semibold text-ink group-hover:text-navy-700">{item.title}</span>
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-ink-muted">
                  {[item.category || "Uncategorized", item.location].filter(Boolean).join(" · ")}
                </span>
                {extra && <span className="mt-2 block">{extra(item, index)}</span>}
              </span>
              <span className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
                {badge?.(item, index)}
                {item.date && <span className="text-[12px] text-ink-muted tabular-nums">{item.date}</span>}
                <span className="font-mono text-[12px] text-slate-400">{item.id}</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-iris-500" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul aria-label={label} className={`grid grid-cols-2 gap-3 sm:gap-4 ${dense ? "md:grid-cols-3 xl:grid-cols-4" : "lg:grid-cols-3 2xl:grid-cols-4"}`}>
      {items.map((item, index) => (
        <li key={item.id} className="min-w-0">
          <button
            type="button"
            onClick={() => onOpen(item, index)}
            className="group flex h-full w-full flex-col overflow-hidden rounded-[20px] border border-white/80 bg-white/90 text-left shadow-card transition-[box-shadow,transform] duration-300 ease-out hover:-translate-y-1 hover:shadow-raised sm:rounded-[22px]"
          >
            <div className="relative">
              <ItemImage item={item} className="aspect-[4/3] w-full" imgClassName="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]" />
              <div className="scrim-bottom pointer-events-none absolute inset-x-0 bottom-0 h-1/3 opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden="true" />
              {showKind && (
                <span className="glass-dark absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold sm:left-3 sm:top-3 sm:px-2.5 sm:text-[12px]">
                  {item.kind === "found" ? <ShieldCheck size={12} className="text-gold-300" aria-hidden="true" /> : <Search size={12} className="text-tide-200" aria-hidden="true" />}
                  {item.kind === "found" ? "In custody" : "Missing"}
                </span>
              )}
              {badge && <span className="absolute right-2 top-2 sm:right-3 sm:top-3">{badge(item, index)}</span>}
            </div>
            <div className="flex flex-1 flex-col p-3 sm:p-4">
              <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink group-hover:text-navy-700 sm:text-[15px]">{item.title}</p>
              <p className="mt-0.5 truncate text-[12px] text-ink-muted sm:text-[13px]">{item.category || "Uncategorized"}</p>
              {extra && <div className="mt-2">{extra(item, index)}</div>}
              <div className="mt-auto flex flex-col gap-1 border-t border-line pt-2.5 text-[12px] text-ink-soft sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:pt-3">
                <span className="flex min-w-0 items-center gap-1"><MapPin size={13} className="shrink-0 text-gold-600" aria-hidden="true" /><span className="truncate">{item.location || "Unknown"}</span></span>
                {item.date && <span className="flex shrink-0 items-center gap-1 tabular-nums"><CalendarDays size={13} className="text-gold-600" aria-hidden="true" />{item.date}</span>}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function KindDot({ kind }: { kind: GalleryItem["kind"] }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${kind === "found" ? "bg-gold-50 text-gold-800 ring-1 ring-gold-200" : "bg-tide-50 text-tide-700 ring-1 ring-tide-200"}`}
    >
      {kind === "found" ? <ShieldCheck size={11} aria-hidden="true" /> : <Search size={11} aria-hidden="true" />}
      {kind === "found" ? "Custody" : "Missing"}
    </span>
  );
}

export default memo(ItemCollection);
