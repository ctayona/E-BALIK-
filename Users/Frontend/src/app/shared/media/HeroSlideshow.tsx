import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, MapPin, Pause, Play, ShieldCheck, Search } from "lucide-react";
import ItemImage, { type GalleryItem } from "./ItemImage";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Accessible auto-advancing hero slideshow.
 * - Pauses on hover, keyboard focus, hidden tab, or via the pause button; never autoplays with reduced motion.
 * - Arrow keys navigate when the carousel has focus; slide changes are announced only while not rotating.
 */
export default function HeroSlideshow({
  items,
  label,
  onOpen,
  intervalMs = 6000,
  overlay,
  empty,
  className = "",
}: {
  items: GalleryItem[];
  label: string;
  onOpen: (item: GalleryItem, index: number) => void;
  intervalMs?: number;
  /** Content laid over the left side of the hero (e.g. greeting + search). */
  overlay?: ReactNode;
  /** Rendered when there are no items. */
  empty?: ReactNode;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const regionRef = useRef<HTMLElement>(null);
  const count = items.length;
  const autoplay = count > 1 && !reducedMotion && !userPaused && !hoverPaused && !hidden;

  const go = useCallback((delta: number) => setIndex((current) => (current + delta + count) % count), [count]);

  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setTimeout(() => go(1), intervalMs);
    return () => window.clearTimeout(timer);
  }, [autoplay, go, index, intervalMs]);

  if (count === 0) {
    return (
      <section className={`relative overflow-hidden rounded-[28px] bg-[radial-gradient(120%_120%_at_0%_0%,#2b4282_0%,#1f3160_40%,#0e1830_100%)] shadow-raised ${className}`}>
        {overlay && <div className="relative z-10 p-6 sm:p-10">{overlay}</div>}
        {empty}
      </section>
    );
  }

  const active = items[Math.min(index, count - 1)];
  const ActiveKindIcon = active.kind === "found" ? ShieldCheck : Search;

  return (
    <section
      ref={regionRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={-1}
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      onFocusCapture={() => setHoverPaused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHoverPaused(false); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
      }}
      className={`group/hero relative isolate overflow-hidden rounded-[28px] bg-navy-950 shadow-raised outline-none ${className}`}
    >
      {/* Slides */}
      {items.map((item, i) => (
        <div
          key={item.id}
          role="group"
          aria-roledescription="slide"
          aria-label={`${i + 1} of ${count}: ${item.title}`}
          aria-hidden={i !== index}
          className={`absolute inset-0 transition-opacity duration-700 ease-out ${i === index ? "opacity-100" : "opacity-0"}`}
        >
          <ItemImage
            key={i === index ? `active-${item.id}-${index}` : item.id}
            item={item}
            size="lg"
            eager={i === 0}
            className="h-full w-full"
            imgClassName={`object-cover ${i === index ? "kenburns" : ""}`}
          />
        </div>
      ))}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(8,14,32,0.92)_0%,rgba(8,14,32,0.62)_38%,rgba(8,14,32,0.08)_72%)]" aria-hidden="true" />
      <div className="scrim-bottom pointer-events-none absolute inset-x-0 bottom-0 h-1/2" aria-hidden="true" />

      <div className="relative z-10 flex h-full min-h-[inherit] flex-col justify-between gap-6 p-5 sm:p-8 lg:p-10">
        {overlay && <div className="max-w-[640px]">{overlay}</div>}

        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          {/* Caption */}
          <div className="glass-dark w-full max-w-[460px] rounded-2xl p-4 sm:p-5" aria-live={autoplay ? "off" : "polite"}>
            <div className="flex items-center gap-2 text-[12px] font-semibold">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${active.kind === "found" ? "bg-gold-500/20 text-gold-200" : "bg-tide-500/20 text-tide-100"}`}>
                <ActiveKindIcon size={13} aria-hidden="true" />{active.kind === "found" ? "In custody" : "Being searched for"}
              </span>
              {active.category && <span className="truncate text-navy-200">{active.category}</span>}
            </div>
            <p className="mt-2 font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight sm:text-[26px]">{active.title}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-navy-100">
              {active.location && <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-gold-300" aria-hidden="true" />{active.location}</span>}
              {active.date && <span className="inline-flex items-center gap-1.5 tabular-nums"><CalendarDays size={14} className="text-gold-300" aria-hidden="true" />{active.date}</span>}
            </div>
            <button
              type="button"
              onClick={() => onOpen(active, index)}
              className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-white px-4 text-[14px] font-semibold text-navy-900 transition hover:bg-gold-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300"
            >
              View details <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>

          {/* Controls */}
          {count > 1 && (
            <div className="flex items-center gap-2 self-start lg:self-end">
              <div className="glass-dark flex items-center gap-1.5 rounded-full px-3 py-2">
                {items.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Show slide ${i + 1}: ${item.title}`}
                    aria-current={i === index ? "true" : undefined}
                    className={`relative h-1.5 overflow-hidden rounded-full transition-[width,background-color] duration-300 ${i === index ? "w-8 bg-white/25" : "w-1.5 bg-white/40 hover:bg-white/70"}`}
                  >
                    {i === index && (
                      <span
                        key={`${index}-${autoplay}`}
                        className={`absolute inset-0 rounded-full bg-gold-400 ${autoplay ? "slide-progress" : ""}`}
                        style={{ animationDuration: `${intervalMs}ms` }}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => go(-1)} aria-label="Previous slide" className="glass-dark flex size-11 items-center justify-center rounded-full transition hover:bg-white/20">
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => go(1)} aria-label="Next slide" className="glass-dark flex size-11 items-center justify-center rounded-full transition hover:bg-white/20">
                <ChevronRight size={20} aria-hidden="true" />
              </button>
              {!reducedMotion && (
                <button
                  type="button"
                  onClick={() => setUserPaused((value) => !value)}
                  aria-pressed={userPaused}
                  aria-label={userPaused ? "Play slideshow" : "Pause slideshow"}
                  className="glass-dark flex size-11 items-center justify-center rounded-full transition hover:bg-white/20"
                >
                  {userPaused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
