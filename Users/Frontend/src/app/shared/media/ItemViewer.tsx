import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Layers, MapPin, Search, ShieldCheck, Tag, X, ZoomIn, ZoomOut } from "lucide-react";
import ItemImage, { type GalleryItem } from "./ItemImage";

/**
 * Full-screen photo viewer: zoom (click/tap to toggle, pointer pans), previous/next across the current list,
 * thumbnail filmstrip, details panel, and caller-supplied actions. Esc closes, ← / → navigate.
 */
export default function ItemViewer({
  items,
  index,
  onIndexChange,
  onClose,
  actions,
  note,
}: {
  items: GalleryItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  actions?: (item: GalleryItem) => ReactNode;
  note?: (item: GalleryItem) => ReactNode;
}) {
  const item = items[index];
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const count = items.length;

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (restoreRef.current && document.contains(restoreRef.current)) restoreRef.current.focus();
    };
  }, []);

  useEffect(() => {
    setZoomed(false);
    stripRef.current?.querySelector<HTMLElement>(`[data-thumb="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key === "ArrowRight" && count > 1) { event.preventDefault(); onIndexChange((index + 1) % count); return; }
      if (event.key === "ArrowLeft" && count > 1) { event.preventDefault(); onIndexChange((index - 1 + count) % count); return; }
      if (event.key === "Tab" && dialogRef.current) {
        const nodes = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, index, onClose, onIndexChange]);

  if (!item) return null;
  const KindIcon = item.kind === "found" ? ShieldCheck : Search;
  const hasPhoto = Boolean(item.image);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-navy-950/85 backdrop-blur-xl sm:p-4 lg:p-8" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-viewer-title"
        className="relative grid w-full max-w-[1240px] grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-navy-950 shadow-overlay sm:rounded-[28px] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-1"
      >
        {/* Stage */}
        <div className="relative flex min-h-[46vh] min-w-0 flex-col bg-[radial-gradient(80%_70%_at_50%_40%,#1f3160_0%,#0e1830_70%)]">
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3 sm:p-4">
            <span className="glass-dark rounded-full px-3 py-1.5 text-[13px] font-medium tabular-nums">{index + 1} / {count}</span>
            <div className="flex items-center gap-2">
              {hasPhoto && (
                <button type="button" onClick={() => setZoomed((value) => !value)} aria-pressed={zoomed} aria-label={zoomed ? "Zoom out" : "Zoom in"} className="glass-dark flex size-11 items-center justify-center rounded-full hover:bg-white/20">
                  {zoomed ? <ZoomOut size={18} aria-hidden="true" /> : <ZoomIn size={18} aria-hidden="true" />}
                </button>
              )}
              <button ref={closeRef} type="button" onClick={onClose} aria-label="Close viewer" className="glass-dark flex size-11 items-center justify-center rounded-full hover:bg-white/20">
                <X size={20} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div
            className={`relative flex flex-1 items-center justify-center overflow-hidden ${hasPhoto ? (zoomed ? "cursor-zoom-out" : "cursor-zoom-in") : ""}`}
            onClick={() => hasPhoto && setZoomed((value) => !value)}
            onPointerMove={(event) => {
              if (!zoomed) return;
              const rect = event.currentTarget.getBoundingClientRect();
              setOrigin(`${((event.clientX - rect.left) / rect.width) * 100}% ${((event.clientY - rect.top) / rect.height) * 100}%`);
            }}
          >
            <ItemImage
              key={item.id}
              item={item}
              size="lg"
              eager
              className="h-full w-full bg-transparent"
              imgClassName="object-contain transition-transform duration-300 ease-out"
              imgStyle={{ transform: `scale(${zoomed ? 2.2 : 1})`, transformOrigin: origin }}
            />
          </div>

          {count > 1 && (
            <>
              <button type="button" onClick={() => onIndexChange((index - 1 + count) % count)} aria-label="Previous item" className="glass-dark absolute left-3 top-1/2 z-10 flex size-12 -translate-y-1/2 items-center justify-center rounded-full hover:bg-white/20 sm:left-4">
                <ChevronLeft size={22} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => onIndexChange((index + 1) % count)} aria-label="Next item" className="glass-dark absolute right-3 top-1/2 z-10 flex size-12 -translate-y-1/2 items-center justify-center rounded-full hover:bg-white/20 sm:right-4">
                <ChevronRight size={22} aria-hidden="true" />
              </button>
              <div ref={stripRef} className="no-scrollbar flex gap-2 overflow-x-auto border-t border-white/10 bg-black/20 p-3" aria-label="Items in this list">
                {items.map((thumb, i) => (
                  <button
                    key={thumb.id}
                    type="button"
                    data-thumb={i}
                    onClick={() => onIndexChange(i)}
                    aria-label={`Show ${thumb.title}`}
                    aria-current={i === index ? "true" : undefined}
                    className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg transition ${i === index ? "ring-2 ring-gold-400 ring-offset-2 ring-offset-navy-950" : "opacity-60 hover:opacity-100"}`}
                  >
                    <ItemImage item={thumb} size="sm" className="h-full w-full" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Details */}
        <aside className="max-h-[54vh] overflow-y-auto bg-white lg:max-h-none">
          <div className="p-6 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${item.kind === "found" ? "bg-gold-50 text-gold-800 ring-1 ring-gold-200" : "bg-tide-50 text-tide-700 ring-1 ring-tide-200"}`}>
                <KindIcon size={13} aria-hidden="true" />{item.kind === "found" ? "In custody" : "Missing report"}
              </span>
              <span className="font-mono text-[12px] text-ink-muted">{item.id}</span>
            </div>
            <h2 id="item-viewer-title" className="mt-3 font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">{item.title}</h2>
            <p className="mt-3 whitespace-pre-line text-[15px] leading-7 text-ink-soft">{item.description || "No public description provided."}</p>

            <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {[
                { icon: Layers, label: "Category", value: item.category || "Uncategorized" },
                { icon: MapPin, label: item.kind === "found" ? "Found at" : "Last seen at", value: item.location || "Not recorded" },
                { icon: CalendarDays, label: item.kind === "found" ? "Date found" : "Date lost", value: item.date || "Not recorded" },
                ...(item.heldAt ? [{ icon: Tag, label: "Held at", value: item.heldAt }] : []),
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3 rounded-2xl border border-line bg-frost-50 p-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-iris-600 shadow-card"><Icon size={16} aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <dt className="text-[12px] font-medium text-ink-muted">{label}</dt>
                    <dd className="mt-0.5 break-words text-[15px] font-semibold text-ink">{value}</dd>
                  </div>
                </div>
              ))}
            </dl>
            {note && <div className="mt-5">{note(item)}</div>}
          </div>
          {actions && <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-white/95 p-5 backdrop-blur sm:p-6">{actions(item)}</div>}
        </aside>
      </div>
    </div>,
    document.body,
  );
}
