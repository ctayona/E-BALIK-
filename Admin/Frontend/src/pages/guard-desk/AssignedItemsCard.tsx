import { useEffect, useState } from "react";
import { PackageOpen, RefreshCw } from "lucide-react";
import { fetchAssignedHandovers, type AssignedHandover } from "../../utils/api";
import { BTN } from "../../components/ui/primitives";
import { tr } from "../../utils/preferences";

const formatDate = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/**
 * The items finders say they handed to a guard and that the office still holds. A guard sees their own list so they know what they
 * should be keeping safe; an administrator sees every guard's (`showGuard`).
 */
export default function AssignedItemsCard({ showGuard = false }: { showGuard?: boolean }) {
  const [items, setItems] = useState<AssignedHandover[] | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError("");
    fetchAssignedHandovers()
      .then((result) => { setItems(result.items); setSetupRequired(result.setupRequired); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : tr("Unable to load the items handed to guards.")))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <section className="admin-card p-5" aria-labelledby="assigned-items-heading">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><PackageOpen size={20} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="assigned-items-heading" className="font-[family-name:var(--font-heading)] text-[17px] font-semibold text-ink">{showGuard ? tr("Items handed to guards") : tr("Items handed to you")}</h2>
          <p className="mt-0.5 text-[13.5px] text-ink-muted">{showGuard ? tr("Found items that finders say they gave to a guard and that are still in custody.") : tr("Found items that finders say they gave to you and that are still in custody. Keep them safe until the Lost and Found Office collects them.")}</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className={BTN.ghost} aria-label={tr("Refresh")}><RefreshCw size={16} className={loading ? "animate-spin" : ""} aria-hidden="true" /></button>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>}
      {!error && setupRequired && <p className="mt-4 rounded-xl border border-gold-200 bg-gold-50 px-4 py-3 text-[14px] text-gold-900">{tr("This list switches on after the latest database update.")}</p>}
      {!error && !setupRequired && items && items.length === 0 && (
        <p className="mt-4 rounded-xl bg-frost-50 px-4 py-6 text-center text-[14px] text-ink-muted">{showGuard ? tr("No items are waiting with a guard right now.") : tr("Nothing has been handed to you right now.")}</p>
      )}
      {!error && items && items.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {items.map((item) => (
            <li key={item.reference} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-ink">{item.item}</p>
                <p className="truncate text-[13px] text-ink-muted">{item.reference}{item.category ? ` · ${item.category}` : ""}{item.storage ? ` · ${item.storage}` : ""}</p>
              </div>
              {showGuard && <p className="text-[13px] font-medium text-ink-soft">{item.guard || "—"}</p>}
              <p className="text-[13px] text-ink-muted">{tr("Handed over {0}", { "0": formatDate(item.handedOverAt) })}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
