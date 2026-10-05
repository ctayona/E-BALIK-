import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Gavel } from "lucide-react";

/** Swipeable photo carousel (CSS scroll-snap) with arrows, dots and keyboard support. */
export default function Gallery({ images, alt, aspect = "aspect-[4/3]", className = "", rounded = "", onOpen }: {
  images: string[];
  alt: string;
  aspect?: string;
  className?: string;
  rounded?: string;
  onOpen?: (index: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = images.length;

  const go = useCallback((next: number) => {
    const element = scroller.current;
    if (!element || count === 0) return;
    const target = (next + count) % count;
    element.scrollTo({ left: target * element.clientWidth, behavior: "smooth" });
  }, [count]);

  useEffect(() => { setIndex(0); scroller.current?.scrollTo({ left: 0 }); }, [images.join("|")]);

  if (count === 0) {
    return (
      <div className={`flex ${aspect} w-full items-center justify-center bg-[radial-gradient(120%_90%_at_20%_0%,#33497f_0%,#1f3160_45%,#0e1830_100%)] text-gold-300 ${rounded} ${className}`} role="img" aria-label={`${alt}: no photo`}>
        <Gavel size={34} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={`group/gallery relative overflow-hidden bg-navy-950 ${rounded} ${className}`}>
      <div
        ref={scroller}
        onScroll={(event) => { const el = event.currentTarget; setIndex(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1))); }}
        onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); } if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); } }}
        tabIndex={count > 1 ? 0 : -1}
        aria-roledescription="carousel"
        aria-label={`${alt} photos`}
        className={`no-scrollbar flex ${aspect} w-full snap-x snap-mandatory overflow-x-auto scroll-smooth outline-none`}
      >
        {images.map((src, i) => (
          <button key={src} type="button" onClick={() => onOpen?.(i)} disabled={!onOpen} aria-label={`${alt}, photo ${i + 1} of ${count}`} className="size-full shrink-0 snap-center disabled:cursor-default">
            <img src={src} alt="" loading={i === 0 ? "eager" : "lazy"} draggable={false} className="size-full object-cover" />
          </button>
        ))}
      </div>
      {count > 1 && (
        <>
          <button type="button" onClick={() => go(index - 1)} aria-label="Previous photo" className="glass-dark absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover/gallery:opacity-100 md:flex"><ChevronLeft size={19} aria-hidden="true" /></button>
          <button type="button" onClick={() => go(index + 1)} aria-label="Next photo" className="glass-dark absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover/gallery:opacity-100 md:flex"><ChevronRight size={19} aria-hidden="true" /></button>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden="true">
            {images.map((src, i) => <span key={src} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-gold-400" : "w-1.5 bg-white/60"}`} />)}
          </div>
        </>
      )}
    </div>
  );
}
