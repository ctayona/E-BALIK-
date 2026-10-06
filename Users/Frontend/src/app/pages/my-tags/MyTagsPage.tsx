import { useCallback, useState } from "react";
import { CalendarClock, QrCode, ShieldCheck, TriangleAlert, Tag as TagIcon } from "lucide-react";
import MyTags from "@/app/shared/tags/MyTags";
import { CX } from "@/app/utils/clay";
import type { OwnerTag } from "@/app/utils/tags";

const SOON_DAYS = 30;

/** Dedicated space for the Smart Tags a user owns: register a sticker, edit privacy, mark lost, and see when each tag expires. */
export default function MyTagsPage() {
  const [tags, setTags] = useState<OwnerTag[] | null>(null);
  const onLoaded = useCallback((list: OwnerTag[]) => setTags(list), []);

  const count = (test: (tag: OwnerTag) => boolean) => (tags ?? []).filter((tag) => !tag.is_disabled && test(tag)).length;
  const stats = [
    { label: "Registered", value: tags?.length ?? 0, icon: <TagIcon size={14} aria-hidden="true" />, tone: "text-white" },
    { label: "Marked lost", value: count((t) => t.status === "lost"), icon: <TriangleAlert size={14} aria-hidden="true" />, tone: "text-gold-300" },
    { label: `Expiring in ${SOON_DAYS} days`, value: count((t) => (t.status === "active" || t.status === "lost") && t.days_left != null && t.days_left <= SOON_DAYS), icon: <CalendarClock size={14} aria-hidden="true" />, tone: "text-gold-300" },
    { label: "Expired", value: count((t) => t.status === "expired"), icon: <CalendarClock size={14} aria-hidden="true" />, tone: "text-[#fda4af]" },
  ];

  return (
    <main className={CX.page}>
      <div className={`${CX.inner} space-y-6`}>
        <section className="relative overflow-hidden rounded-[26px] border border-white/15 bg-[#162448] p-6 text-white sm:p-8 lg:p-10" aria-labelledby="my-tags-hero">
          <div className="pointer-events-none absolute -right-12 -top-16 size-64 rounded-full border border-gold-400/15" aria-hidden="true" />
          <div className="pointer-events-none absolute -right-2 -top-6 size-44 rounded-full border border-gold-400/10" aria-hidden="true" />
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-1 text-[13px] font-semibold text-gold-300"><QrCode size={13} aria-hidden="true" /> Smart Tags</span>
              <h1 id="my-tags-hero" className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl" style={{ fontFamily: "var(--font-heading)" }}>My Smart Tags</h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-white/70">Stick a tag on your laptop, bag or bottle. If someone finds it, they scan the code and you are notified right away. You choose what they can see.</p>
              <p className="mt-4 flex items-start gap-2 text-[13.5px] leading-6 text-white/60"><ShieldCheck size={15} className="mt-1 shrink-0 text-gold-300" aria-hidden="true" />Tags work for the validity period they were issued with. You are warned 30 days before one expires.</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-white/55">{stat.icon}{stat.label}</dt>
                  <dd className={`mt-1 text-2xl font-semibold tabular-nums ${stat.tone}`}>{tags === null ? "–" : stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <MyTags standalone onLoaded={onLoaded} />
      </div>
    </main>
  );
}
