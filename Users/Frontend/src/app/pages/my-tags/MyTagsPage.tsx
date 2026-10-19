import { useCallback, useState } from "react";
import { CalendarClock, Camera, Plus, QrCode, ShieldCheck, Tag as TagIcon, TriangleAlert } from "lucide-react";
import MyTags, { TAG_STEPS } from "@/app/shared/tags/MyTags";
import RegisterTagModal from "@/app/shared/tags/RegisterTagModal";
import { CX } from "@/app/utils/clay";
import type { OwnerTag } from "@/app/utils/tags";

const SOON_DAYS = 30;

/** Dedicated space for the Smart Tags a user owns: register a sticker, edit privacy, mark lost, and see when each tag expires. */
export default function MyTagsPage() {
  const [tags, setTags] = useState<OwnerTag[] | null>(null);
  const [registering, setRegistering] = useState(false);
  const [startCode, setStartCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const startRegistration = useCallback((code?: string) => { setStartCode(code); setRegistering(true); }, []);
  const onLoaded = useCallback((list: OwnerTag[]) => setTags(list), []);

  const count = (test: (tag: OwnerTag) => boolean) => (tags ?? []).filter((tag) => !tag.is_disabled && test(tag)).length;
  const stats = [
    { label: "Registered", value: tags?.length ?? 0, icon: <TagIcon size={14} aria-hidden="true" />, tone: "text-white" },
    { label: "Marked lost", value: count((t) => t.status === "lost"), icon: <TriangleAlert size={14} aria-hidden="true" />, tone: "text-gold-300" },
    { label: `Expiring in ${SOON_DAYS} days`, value: count((t) => (t.status === "active" || t.status === "lost") && t.days_left != null && t.days_left <= SOON_DAYS), icon: <CalendarClock size={14} aria-hidden="true" />, tone: "text-gold-300" },
    { label: "Expired", value: count((t) => t.status === "expired"), icon: <CalendarClock size={14} aria-hidden="true" />, tone: "text-[#fda4af]" },
  ];
  const hasTags = Boolean(tags && tags.length > 0);

  return (
    <main className={CX.page}>
      <div className={`${CX.inner} space-y-6`}>
        <section className="relative overflow-hidden rounded-[28px] border border-white/15 bg-[linear-gradient(150deg,#0e1830_0%,#162448_45%,#1f3160_100%)] p-6 text-white shadow-raised sm:p-8 lg:p-10" aria-labelledby="my-tags-hero">
          <span className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-gold-500/10 blur-3xl" aria-hidden="true" />
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-1 text-[13px] font-semibold text-gold-300"><QrCode size={13} aria-hidden="true" /> Smart Tags</span>
              <h1 id="my-tags-hero" className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-4xl" style={{ fontFamily: "var(--font-heading)" }}>My Smart Tags</h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-white/70">Stick a tag on your laptop, bag or bottle. If someone finds it, they scan the code and you are notified right away. You choose what they can see.</p>
              <button type="button" onClick={() => startRegistration()} className={`${CX.btnGold} mt-5 min-h-[50px] px-7 text-[15.5px] max-sm:hidden`}><Camera size={18} aria-hidden="true" />Register a new tag</button>
              <p className="mt-4 flex items-start gap-2 text-[13.5px] leading-6 text-white/60"><ShieldCheck size={15} className="mt-1 shrink-0 text-gold-300" aria-hidden="true" />Tags work for the validity period they were issued with. You are warned 30 days before one expires.</p>
            </div>

            {/* The stats sit on a slowly turning gold ring. */}
            <div className="relative">
              <span className="pointer-events-none absolute left-1/2 top-1/2 size-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(209,161,83,0.55)_70deg,transparent_140deg,rgba(209,161,83,0.25)_230deg,transparent_300deg)] opacity-70 blur-[2px] [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),#000_calc(100%-2px))] animate-[spin_18s_linear_infinite] motion-reduce:animate-none" aria-hidden="true" />
              <span className="pointer-events-none absolute left-1/2 top-1/2 size-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-400/10 blur-2xl" aria-hidden="true" />
              <dl className="relative grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-md">
                {stats.map((stat) => (
                  <div key={stat.label} className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                    <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-white/55">{stat.icon}{stat.label}</dt>
                    <dd className={`mt-1 text-2xl font-semibold tabular-nums ${stat.tone}`}>{tags === null ? "–" : stat.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {hasTags && (
            <ol className="relative mt-8 grid gap-3 sm:grid-cols-3" aria-label="How Smart Tags work">
              {TAG_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-md">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950">{step.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-semibold"><span className="mr-1.5 text-gold-300">{index + 1}.</span>{step.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-5 text-white/65">{step.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <MyTags onLoaded={onLoaded} onRegister={startRegistration} reloadKey={reloadKey} />
        <RegisterTagModal open={registering} initialCode={startCode} onClose={() => setRegistering(false)} onRegistered={() => setReloadKey((value) => value + 1)} />
      </div>

      {/* Phones: registering is one thumb away, above the bottom bar. */}
      <button
        type="button"
        onClick={() => startRegistration()}
        aria-label="Register a new tag"
        className="fixed bottom-[calc(92px+env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-30 flex h-14 items-center gap-2 rounded-full bg-[linear-gradient(160deg,#f3dcab_0%,#d1a153_60%,#b9873a_100%)] pl-4 pr-5 text-[15px] font-semibold text-navy-950 shadow-[0_16px_32px_-10px_rgba(209,161,83,0.95),inset_0_1px_0_rgba(255,255,255,0.5)] transition-transform active:scale-95 sm:hidden"
      >
        <Plus size={22} strokeWidth={2.4} aria-hidden="true" />Register
      </button>
    </main>
  );
}
