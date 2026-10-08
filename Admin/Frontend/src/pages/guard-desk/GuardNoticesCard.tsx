import { useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { fetchMyNotices, markNoticeRead, type StaffNotice } from "../../utils/api";
import { BTN } from "../../components/ui/primitives";
import { tr } from "../../utils/preferences";

const formatMoment = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
};

/**
 * What the system told this guard: a finder handed them an item, an item was released. These notices were already being sent,
 * but a guard has no other page to read them on, so they are shown at the top of the release desk.
 * Shows nothing at all when there are no unread notices and no error.
 */
export default function GuardNoticesCard() {
  const [notices, setNotices] = useState<StaffNotice[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchMyNotices(20)
      .then((rows) => { if (active) setNotices(rows); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : tr("Unable to load your notices.")); });
    return () => { active = false; };
  }, []);

  const unread = notices.filter((notice) => !notice.read);

  const markRead = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => markNoticeRead(id)));
      setNotices((current) => current.map((notice) => ids.includes(notice.id) ? { ...notice, read: true } : notice));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("Unable to mark the notice as read."));
    }
  };

  if (!error && unread.length === 0) return null;

  return (
    <section className="admin-card p-5" aria-labelledby="guard-notices-heading">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300" aria-hidden="true"><Bell size={20} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="guard-notices-heading" className="font-[family-name:var(--font-heading)] text-[17px] font-semibold text-ink">{tr("New notices")}</h2>
          <p className="mt-0.5 text-[13.5px] text-ink-muted">{tr("Finders who handed you an item, and other updates for you.")}</p>
        </div>
        {unread.length > 1 && (
          <button type="button" onClick={() => markRead(unread.map((notice) => notice.id))} className={BTN.ghost}><CheckCheck size={16} aria-hidden="true" />{tr("Mark all read")}</button>
        )}
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>}
      {unread.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {unread.map((notice) => (
            <li key={notice.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-ink">{notice.title}</p>
                <p className="mt-0.5 text-[13.5px] leading-6 text-ink-soft">{notice.message}</p>
                <p className="mt-1 text-[12.5px] text-ink-muted">{formatMoment(notice.createdAt)}</p>
              </div>
              <button type="button" onClick={() => markRead([notice.id])} className={BTN.ghost}>{tr("Mark read")}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
