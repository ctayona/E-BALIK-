import { useEffect, useState } from "react";
import { Printer, ScrollText } from "lucide-react";
import { fetchCustodyHistory, type CustodyHistory } from "../../utils/api";
import { tr } from "../../utils/preferences";
import AdminModal from "../../components/ui/AdminModal";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { BTN } from "../../components/ui/primitives";

/** Event colors: one per kind of step so a long timeline can be scanned. Unknown kinds fall back to navy. */
const EVENT_COLOR: Record<string, string> = {
  turned_over: "#0f8077",
  registered: "#3b82f6",
  received: "#0f8077",
  tag_matched: "#7c3aed",
  claim_filed: "#d97706",
  claim_approved: "#059669",
  claim_rejected: "#e11d48",
  claim_expired: "#64748b",
  released: "#4f46e5",
  completed: "#4f46e5",
  auction_listed: "#b45309",
  auction_confirmed: "#b45309",
  auction_cancelled: "#64748b",
  auction_completed: "#4f46e5",
  auction_forfeited: "#e11d48",
  returned_to_custody: "#64748b",
};

/** Makati time, so the printed record matches what the guard and the owner saw. */
function formatMoment(value: string | null): string {
  if (!value) return tr("Date unavailable");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

/**
 * The handling history of one found item, oldest step first: handed over, received by the guard, claims, release, auction.
 * "Print or save as PDF" keeps what the old Chain of custody page offered, and prints only this record.
 */
export default function CustodyHistoryModal({ reference, onClose }: { reference: string; onClose: () => void }) {
  const [history, setHistory] = useState<CustodyHistory | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchCustodyHistory(reference)
      .then((result) => { if (active) setHistory(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : tr("Unable to load the item history.")); });
    return () => { active = false; };
  }, [reference]);

  const printRecord = () => {
    document.body.classList.add("print-history");
    const cleanup = () => { document.body.classList.remove("print-history"); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    window.print();
  };

  const item = history?.item;

  return (
    <AdminModal
      title={tr("Handling history")}
      description={item ? `${item.item_name} · ${item.fpost_id}` : reference}
      icon={<ScrollText size={20} />}
      tone="navy"
      size="lg"
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={BTN.ghost}>{tr("Close")}</button>
        <button type="button" onClick={printRecord} disabled={!history} className={BTN.primary}><Printer size={16} aria-hidden="true" />{tr("Print or save as PDF")}</button>
      </>}
    >
      {!history && !error && <div className="space-y-3" aria-busy="true"><SkeletonBlock className="h-16 w-full rounded-xl" /><SkeletonBlock className="h-16 w-full rounded-xl" /><SkeletonBlock className="h-16 w-full rounded-xl" /></div>}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>}
      {history && item && (
        <div className="custody-history">
          <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-line bg-frost-50 p-4 text-[13.5px] sm:grid-cols-3">
            {([
              [tr("Category"), item.category],
              [tr("Found at"), item.location],
              [tr("Stored at"), item.turnover_location],
              [tr("Date found"), item.found_date],
              [tr("Received by"), item.guard_name_or_id],
              [tr("Status"), item.status],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label}><dt className="text-ink-muted">{label}</dt><dd className="mt-0.5 font-medium text-ink">{value || "—"}</dd></div>
            ))}
          </dl>
          {history.events.length === 0
            ? <p className="text-[14px] text-ink-muted">{tr("No steps are recorded for this item yet.")}</p>
            : (
              <ol className="space-y-0">
                {history.events.map((event, index) => {
                  const color = EVENT_COLOR[event.type] ?? "#1f3160";
                  return (
                    <li key={`${event.type}-${index}`} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <span className="mt-1 size-3.5 shrink-0 rounded-full ring-4 ring-[var(--surface)]" style={{ background: color }} aria-hidden="true" />
                        {index < history.events.length - 1 && <span className="my-1 w-0.5 flex-1 bg-slate-200" style={{ minHeight: 28 }} aria-hidden="true" />}
                      </div>
                      <div className="min-w-0 flex-1 pb-5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="rounded px-2 py-0.5 text-[12.5px] font-semibold" style={{ background: `${color}1f`, color }}>{event.label}</span>
                          <span className="text-[12.5px] text-ink-muted">{formatMoment(event.at)}</span>
                        </div>
                        {event.actor && <div className="mt-1 text-[13px] font-semibold text-ink-soft">{event.actor}</div>}
                        {event.detail && <p className="mt-0.5 text-[14px] leading-6 text-ink">{event.detail}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
        </div>
      )}
    </AdminModal>
  );
}
