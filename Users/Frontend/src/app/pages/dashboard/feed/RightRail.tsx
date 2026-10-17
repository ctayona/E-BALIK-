import { AlertTriangle, Clock3, Info, Mail, MapPin, Megaphone, PhoneCall, ShieldAlert } from "lucide-react";
import type { FeedCounts } from "@/app/utils/api";
import { useAnnouncement, type AnnouncementTone } from "@/app/utils/system";
import { OFFICE, hotlineHref } from "./officeInfo";
import { FEED_CARD } from "./feedStyle";

const TONE: Record<AnnouncementTone, { box: string; icon: typeof Info }> = {
  info: { box: "border-iris-200 bg-iris-50 text-navy-800", icon: Info },
  success: { box: "border-tide-200 bg-tide-50 text-tide-700", icon: Megaphone },
  warning: { box: "border-gold-300 bg-gold-50 text-gold-900", icon: AlertTriangle },
  critical: { box: "border-rose-200 bg-rose-50 text-rose-800", icon: ShieldAlert },
};

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`${FEED_CARD} p-4 ${className}`}>
      <h2 className="mb-2.5 font-[family-name:var(--font-heading)] text-[16px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Right column: the Lost and Found Office (hours, place, hotline) and urgent bulletins (the campus announcement, urgent counts, safety tips).
 * `compact` is the short version shown inside the feed column on screens too narrow for a third column.
 */
export default function RightRail({ counts, urgent, compact = false }: { counts: FeedCounts | null; urgent: number; compact?: boolean }) {
  const note = useAnnouncement();
  const tone = note ? TONE[note.tone] : null;
  return (
    <aside aria-label={compact ? "Office information" : "Office and bulletins"} className={compact ? "space-y-3" : "space-y-4"}>
      <Card title="Lost and Found Office">
        <ul className="space-y-2.5 text-[14px] leading-5 text-ink-soft">
          <li className="flex gap-2.5"><Clock3 size={17} className="mt-0.5 shrink-0 text-gold-700" aria-hidden="true" /><span><span className="block font-semibold text-ink">Office hours</span>{OFFICE.hours}</span></li>
          <li className="flex gap-2.5"><MapPin size={17} className="mt-0.5 shrink-0 text-gold-700" aria-hidden="true" /><span><span className="block font-semibold text-ink">Where</span>{OFFICE.address}</span></li>
        </ul>
        <a href={hotlineHref} className="mt-3 flex items-center gap-3 rounded-2xl bg-[linear-gradient(135deg,#22366a_0%,#162448_100%)] px-3.5 py-3 text-white transition-opacity hover:opacity-95">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-gold-300" aria-hidden="true"><PhoneCall size={19} /></span>
          <span className="min-w-0"><span className="block text-[12.5px] text-navy-100">Security desk hotline</span><span className="block font-mono text-[18px] font-semibold tracking-wide">{OFFICE.hotline}</span></span>
        </a>
        <p className="mt-2.5 flex items-start gap-2 text-[12.5px] leading-5 text-ink-muted"><Mail size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><a href={`mailto:${OFFICE.email}`} className="break-all hover:underline">{OFFICE.email}</a></p>
        <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">After hours, hand found items to the {OFFICE.securityDesk}.</p>
      </Card>

      {!compact && (
        <Card title="Urgent bulletins">
          <div className="space-y-2.5">
            {note && tone && (
              <div role="status" className={`flex gap-2.5 rounded-2xl border p-3 text-[13.5px] leading-5 ${tone.box}`}>
                <tone.icon size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p className="min-w-0 break-words">{note.title && <span className="block font-semibold">{note.title}</span>}{note.message}</p>
              </div>
            )}
            {urgent > 0 && (
              <p className="flex gap-2.5 rounded-2xl border border-gold-200 bg-gold-50 p-3 text-[13.5px] leading-5 text-gold-900"><AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" /><span><span className="font-semibold">{urgent} urgent {urgent === 1 ? "report" : "reports"} this week.</span> IDs, wallets, phones and keys are listed in the bar above the feed.</span></p>
            )}
            {!note && urgent === 0 && <p className="text-[13.5px] leading-5 text-ink-muted">No urgent bulletins right now. Campus announcements from the office will appear here.</p>}
          </div>
          {counts && (
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
              {[{ label: "in custody", value: counts.found }, { label: "found this week", value: counts.found_this_week }, { label: "missing", value: counts.missing }].map((stat) => (
                <div key={stat.label}><dd className="font-[family-name:var(--font-heading)] text-[20px] font-semibold tabular-nums text-ink">{stat.value}</dd><dt className="text-[11.5px] leading-4 text-ink-muted">{stat.label}</dt></div>
              ))}
            </dl>
          )}
        </Card>
      )}

      {!compact && (
        <Card title="Stay safe">
          <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-5 text-ink-soft marker:text-gold-600">
            <li>Never post phone numbers or emails in comments.</li>
            <li>Bring your original ID to collect an item.</li>
            <li>Nobody from E-Balik will ask for your password or verification code.</li>
          </ul>
        </Card>
      )}
    </aside>
  );
}
