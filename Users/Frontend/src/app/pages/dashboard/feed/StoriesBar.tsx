import { useRef } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import ItemImage, { categoryIcon } from "@/app/shared/media/ItemImage";
import type { FeedStory } from "@/app/utils/api";
import { timeAgo } from "./time";

/**
 * Urgent items as a row of story cards: IDs, cards, wallets, phones and keys reported in the last week, newest first.
 * The first card starts a new report. A story opens the item (the page decides what that means).
 */
export default function StoriesBar({ stories, loading, onOpen, onCreate }: { stories: FeedStory[]; loading: boolean; onOpen: (index: number) => void; onCreate: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (direction: number) => track.current?.scrollBy({ left: direction * 360, behavior: "smooth" });

  return (
    <section aria-label="Urgent items" className="relative">
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 className="font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink">Urgent this week</h2>
        <p className="text-[12.5px] text-ink-muted">IDs, wallets, phones and keys people need back fast</p>
      </div>
      <div ref={track} className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={onCreate}
          className="group relative flex h-[184px] w-[112px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/90 text-left shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-raised"
        >
          <span className="flex flex-1 items-center justify-center bg-[radial-gradient(120%_90%_at_20%_0%,#33497f_0%,#1f3160_55%,#0e1830_100%)]">
            <span className="flex size-10 items-center justify-center rounded-full bg-gradient-to-b from-[#e6be76] to-[#d1a153] text-navy-950 ring-4 ring-white/15 transition-transform group-hover:scale-110"><Plus size={22} aria-hidden="true" /></span>
          </span>
          <span className="px-2.5 py-2 text-[13px] font-semibold leading-tight text-ink">Report an item</span>
        </button>

        {loading && Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[184px] w-[112px] shrink-0 animate-pulse rounded-2xl bg-frost-100" aria-hidden="true" />)}

        {!loading && stories.map((story, index) => {
          const Icon = categoryIcon(story.category);
          const found = story.kind === "found";
          return (
            <button
              key={`${story.kind}-${story.reference}`}
              type="button"
              onClick={() => onOpen(index)}
              aria-label={`${found ? "Found" : "Missing"}: ${story.item_name}, ${timeAgo(story.created_at)}`}
              className="group relative h-[184px] w-[112px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/80 bg-navy-900 text-left shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-raised"
            >
              <ItemImage item={{ image: story.image_url || undefined, title: story.item_name, category: story.category }} size="sm" className="absolute inset-0 size-full" imgClassName="object-cover transition-transform duration-500 group-hover:scale-105" />
              <span className="absolute inset-0 bg-gradient-to-t from-[#0b1330]/90 via-[#0b1330]/15 to-[#0b1330]/35" aria-hidden="true" />
              <span className={`absolute left-2 top-2 flex size-9 items-center justify-center rounded-full bg-[#101a3a] text-white ring-[3px] ${found ? "ring-[#d1a153]" : "ring-[#6e8ef0]"}`}><Icon size={16} aria-hidden="true" /></span>
              <span className="absolute inset-x-2 bottom-2 text-white">
                <span className={`mb-1 inline-block rounded-full px-1.5 py-px text-[10.5px] font-bold ${found ? "bg-[#d1a153] text-navy-950" : "bg-[#6e8ef0] text-white"}`}>{found ? "Found" : "Missing"} · {timeAgo(story.created_at)}</span>
                <span className="line-clamp-2 block text-[13px] font-semibold leading-tight">{story.item_name}</span>
              </span>
            </button>
          );
        })}

        {!loading && stories.length === 0 && (
          <p className="flex h-[184px] min-w-[220px] flex-1 items-center rounded-2xl border border-dashed border-line-strong px-4 text-[13.5px] leading-5 text-ink-muted">No urgent reports this week. IDs, wallets, phones and keys will show up here as soon as they are reported.</p>
        )}
      </div>
      {stories.length > 4 && (
        <>
          <button type="button" onClick={() => scroll(-1)} aria-label="Scroll urgent items left" className="absolute left-0 top-[88px] hidden size-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-white text-ink shadow-raised md:flex"><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" onClick={() => scroll(1)} aria-label="Scroll urgent items right" className="absolute right-0 top-[88px] hidden size-9 translate-x-1/2 items-center justify-center rounded-full border border-line bg-white text-ink shadow-raised md:flex"><ChevronRight size={18} aria-hidden="true" /></button>
        </>
      )}
    </section>
  );
}
