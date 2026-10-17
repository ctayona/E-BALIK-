import { useRef } from "react";
import { ChevronLeft, ChevronRight, Flame, Plus } from "lucide-react";
import ItemImage, { categoryIcon } from "@/app/shared/media/ItemImage";
import type { FeedStory } from "@/app/utils/api";
import { timeAgo } from "./time";
import { FEED_CARD, FEED_CARD_LIFT, GOLD_GRADIENT } from "./feedStyle";

const CARD = "h-[188px] w-[116px] shrink-0 snap-start";

/**
 * Urgent items as a row of story cards: IDs, cards, wallets, phones and keys reported in the last week, newest first.
 * The first card starts a new report. A story opens the item (the page decides what that means).
 */
export default function StoriesBar({ stories, loading, onOpen, onCreate }: { stories: FeedStory[]; loading: boolean; onOpen: (index: number) => void; onCreate: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (direction: number) => track.current?.scrollBy({ left: direction * 360, behavior: "smooth" });

  return (
    <section aria-label="Urgent items" className="relative">
      <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
        <h2 className="inline-flex shrink-0 items-center gap-2 font-[family-name:var(--font-heading)] text-[16.5px] font-semibold tracking-[-0.01em] text-ink">
          <span className="flex size-6 items-center justify-center rounded-lg bg-gold-50 text-gold-700 ring-1 ring-gold-200" aria-hidden="true"><Flame size={14} /></span>
          Urgent this week
          {stories.length > 0 && <span className="rounded-full bg-navy-800 px-2 py-px text-[11.5px] font-bold tabular-nums text-white">{stories.length}</span>}
        </h2>
        <p className="hidden min-w-0 truncate text-[12.5px] text-ink-muted sm:block">IDs, wallets, phones and keys people need back fast</p>
      </div>
      <div ref={track} className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain scroll-smooth px-1 pb-2 pt-0.5 [-webkit-overflow-scrolling:touch]">
        <button type="button" onClick={onCreate} className={`group relative flex ${CARD} flex-col overflow-hidden text-left ${FEED_CARD} ${FEED_CARD_LIFT}`}>
          <span className="relative flex flex-1 items-center justify-center bg-[radial-gradient(120%_90%_at_20%_0%,#3d548c_0%,#1f3160_55%,#0e1830_100%)]">
            <span className="pointer-events-none absolute -right-6 -top-6 size-20 rounded-full bg-gold-400/20 blur-2xl" aria-hidden="true" />
            <span className={`relative flex size-11 items-center justify-center rounded-full text-navy-950 ring-4 ring-white/15 transition-transform duration-300 group-hover:rotate-90 group-hover:scale-110 ${GOLD_GRADIENT}`}><Plus size={22} aria-hidden="true" /></span>
          </span>
          <span className="px-2.5 py-2.5 text-[13px] font-semibold leading-tight text-ink">Report an item</span>
        </button>

        {loading && Array.from({ length: 5 }, (_, index) => <div key={index} className={`${CARD} animate-pulse rounded-[18px] bg-frost-100`} aria-hidden="true" />)}

        {!loading && stories.map((story, index) => {
          const Icon = categoryIcon(story.category);
          const found = story.kind === "found";
          return (
            <button
              key={`${story.kind}-${story.reference}`}
              type="button"
              onClick={() => onOpen(index)}
              aria-label={`${found ? "Found" : "Missing"}: ${story.item_name}, ${timeAgo(story.created_at)}`}
              className={`group relative ${CARD} overflow-hidden rounded-[18px] border border-white/70 bg-navy-900 text-left shadow-card ring-1 ring-navy-900/10 ${FEED_CARD_LIFT}`}
            >
              <ItemImage item={{ image: story.image_url || undefined, title: story.item_name, category: story.category }} size="sm" className="absolute inset-0 size-full" imgClassName="object-cover transition-transform duration-700 ease-out group-hover:scale-110" />
              <span className="absolute inset-0 bg-gradient-to-t from-[#0b1330]/95 via-[#0b1330]/20 to-[#0b1330]/45" aria-hidden="true" />
              <span className={`absolute left-2 top-2 rounded-full p-[2.5px] ${found ? "bg-[linear-gradient(135deg,#f3dcab,#d1a153)]" : "bg-[linear-gradient(135deg,#9db4f5,#6e8ef0)]"}`} aria-hidden="true">
                <span className="flex size-8 items-center justify-center rounded-full bg-[#101a3a] text-white ring-2 ring-[#101a3a]"><Icon size={15} /></span>
              </span>
              <span className="absolute inset-x-2.5 bottom-2.5 text-white">
                <span className={`mb-1.5 inline-block rounded-full px-2 py-px text-[10.5px] font-bold tracking-wide ${found ? "bg-[#d1a153] text-navy-950" : "bg-[#6e8ef0] text-white"}`}>{found ? "Found" : "Missing"} · {timeAgo(story.created_at)}</span>
                <span className="line-clamp-2 block text-[13px] font-semibold leading-tight">{story.item_name}</span>
              </span>
            </button>
          );
        })}

        {!loading && stories.length === 0 && (
          <p className="flex h-[188px] min-w-[220px] flex-1 items-center rounded-[18px] border border-dashed border-line-strong bg-white/50 px-4 text-[13.5px] leading-5 text-ink-muted">No urgent reports this week. IDs, wallets, phones and keys will show up here as soon as they are reported.</p>
        )}
      </div>
      {stories.length > 4 && (
        <>
          <button type="button" onClick={() => scroll(-1)} aria-label="Scroll urgent items left" className="absolute left-0 top-[100px] hidden size-10 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-white/95 text-ink shadow-raised backdrop-blur transition-transform hover:scale-105 active:scale-95 md:flex"><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" onClick={() => scroll(1)} aria-label="Scroll urgent items right" className="absolute right-0 top-[100px] hidden size-10 translate-x-1/2 items-center justify-center rounded-full border border-line bg-white/95 text-ink shadow-raised backdrop-blur transition-transform hover:scale-105 active:scale-95 md:flex"><ChevronRight size={18} aria-hidden="true" /></button>
        </>
      )}
    </section>
  );
}
