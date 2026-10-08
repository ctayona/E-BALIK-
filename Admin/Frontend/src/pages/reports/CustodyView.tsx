import { useEffect, useMemo, useState } from "react";
import { AlarmClock, Boxes, Gavel, HandCoins, ScrollText, ShieldAlert, Tag, Timer } from "lucide-react";
import { fetchAdminCustody, type AdminCustodyOverview, type AdminCustodyRow, type CustodyState } from "../../utils/api";
import { downloadCsv } from "../../utils/csv";
import { tr } from "../../utils/preferences";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import { BTN } from "../../components/ui/primitives";
import { DataTable, ExportButton, SearchField, SegmentedFilter, StatusPill, TableFooter, Thumb, Toolbar, usePagination, type Tone } from "../../components/ui/management";
import CustodyHistoryModal from "./CustodyHistoryModal";

type NavTarget = "claims" | "auctions";
type Filter = "all" | "review" | "pickup" | "auction" | "waiting" | "hold";

const STATE_TONE: Record<CustodyState, Tone> = {
  waiting: "slate",
  claim_review: "gold",
  claim_approved: "mint",
  hold: "slate",
  auction: "iris",
  auction_review: "gold",
  sold_pickup: "mint",
};

const FILTER_STATES: Record<Exclude<Filter, "all">, CustodyState[]> = {
  review: ["claim_review", "auction_review"],
  pickup: ["claim_approved", "sold_pickup"],
  auction: ["auction"],
  waiting: ["waiting"],
  hold: ["hold"],
};

/** What an administrator does next for each state, and where to do it. */
function nextStep(row: AdminCustodyRow): { label: string; target: NavTarget } | null {
  switch (row.state) {
    case "claim_review": return { label: "Review claim", target: "claims" };
    case "claim_approved": return { label: "Open claims", target: "claims" };
    case "auction_review": return { label: "Confirm winner", target: "auctions" };
    case "sold_pickup": return { label: "Open auctions", target: "auctions" };
    case "auction": return { label: "Open auctions", target: "auctions" };
    case "waiting": return row.auctionEligible ? { label: "Create auction", target: "auctions" } : null;
    default: return null;
  }
}

/** Items in custody: every found item the office still holds, what is happening to it, and where to act next. */
export default function CustodyView({ onNavigate }: { onNavigate: (target: NavTarget) => void }) {
  const [data, setData] = useState<AdminCustodyOverview | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [historyOf, setHistoryOf] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAdminCustody()
      .then((overview) => { if (active) setData(overview); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : tr("Unable to load the items in custody")); });
    return () => { active = false; };
  }, []);

  const rows = data?.items ?? [];
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: rows.length, review: 0, pickup: 0, auction: 0, waiting: 0, hold: 0 };
    for (const row of rows) {
      for (const [key, states] of Object.entries(FILTER_STATES)) if (states.includes(row.state)) result[key as Filter] += 1;
    }
    return result;
  }, [rows]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== "all" && !FILTER_STATES[filter].includes(row.state)) return false;
      return !query || [row.item, row.reference, row.storage, row.guard, row.category].some((value) => value?.toLowerCase().includes(query));
    });
  }, [rows, filter, search]);
  const paging = usePagination(filtered, 12, `${search}|${filter}`);

  if (!data && !error) {
    return <div className="space-y-5" aria-busy="true"><SkeletonBlock className="h-24 w-full rounded-2xl" /><AdminTableSkeleton columns={7} rows={6} /></div>;
  }
  if (!data) {
    return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>;
  }

  const summary = data.summary;
  const exportCsv = () => downloadCsv("items-in-custody", ["Reference", "Item", "Category", "Storage", "Received by", "Days held", "Status", "Open claims"],
    filtered.map((row) => [row.reference, row.item, row.category, row.storage, row.guard, row.daysHeld, tr(row.stateLabel), row.openClaims]));

  return (
    <div className="space-y-5">
      <section className="glass-panel overflow-hidden" aria-label={tr("Custody summary")}>
        <dl className="grid grid-cols-2 lg:grid-cols-4 [&>*]:border-line max-lg:[&>*:nth-child(-n+2)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:divide-x lg:divide-line">
          {[
            { label: "In custody", value: summary.total, hint: tr("Items the office is holding"), icon: <Boxes size={16} aria-hidden="true" /> },
            { label: "Needs review", value: summary.needsReview, hint: summary.overdueClaims > 0 ? tr("{0} claims waiting over {1} days", { "0": summary.overdueClaims, "1": summary.staleClaimDays }) : tr("Claims and auction results to decide"), icon: <ShieldAlert size={16} aria-hidden="true" /> },
            { label: "Waiting for pickup", value: summary.awaitingPickup, hint: tr("Approved claims and auction winners"), icon: <HandCoins size={16} aria-hidden="true" /> },
            { label: "Ready to auction", value: summary.auctionEligible, hint: tr("Unclaimed over {0} days", { "0": summary.minCustodyDays }), icon: <Timer size={16} aria-hidden="true" /> },
          ].map((stat) => (
            <div key={stat.label} className="px-5 py-4 sm:px-6 sm:py-5">
              <dt className="flex items-center gap-2 text-[13px] font-medium text-ink-muted"><span className="text-gold-600">{stat.icon}</span>{tr(stat.label)}</dt>
              <dd className="mt-1.5 font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-none tabular-nums text-ink">{stat.value}</dd>
              <p className="mt-1.5 text-[12.5px] text-ink-muted">{stat.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      {summary.awaitingReceipt > 0 && (
        <p className="rounded-xl border border-gold-200 bg-gold-50 px-4 py-3 text-[14px] text-ink-soft">
          {tr("{0} items were handed to a guard who has not confirmed receiving them yet.", { "0": summary.awaitingReceipt })}
        </p>
      )}

      <SegmentedFilter
        label="Custody status"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All", count: counts.all },
          { value: "review", label: "Needs review", count: counts.review },
          { value: "pickup", label: "Waiting for pickup", count: counts.pickup },
          { value: "auction", label: "In auction", count: counts.auction },
          { value: "waiting", label: "Waiting for the owner", count: counts.waiting },
          { value: "hold", label: "On hold", count: counts.hold },
        ]}
      />

      <Toolbar trailing={<ExportButton onClick={exportCsv} disabled={!filtered.length} />}>
        <SearchField value={search} onChange={setSearch} placeholder="Search item, reference, storage or guard" />
      </Toolbar>

      <DataTable
        caption={tr("Items in custody")}
        columns={[
          { key: "ref", label: tr("Reference") },
          { key: "item", label: tr("Item") },
          { key: "storage", label: tr("Stored at") },
          { key: "guard", label: tr("Received by") },
          { key: "days", label: tr("Days held"), className: "text-right" },
          { key: "status", label: tr("Status") },
          { key: "next", label: tr("Next step") },
          { key: "history", label: tr("History") },
        ]}
        isEmpty={paging.pageItems.length === 0}
        empty={rows.length === 0 ? tr("Nothing is in custody right now.") : tr("No items match your search.")}
        footer={<TableFooter {...paging} onPage={paging.setPage} />}
      >
        {paging.pageItems.map((row) => {
          const step = nextStep(row);
          return (
            <tr key={row.reference} data-tone={STATE_TONE[row.state]}>
              <td className="whitespace-nowrap font-semibold text-ink">{row.reference}</td>
              <td>
                <div className="flex min-w-[200px] max-w-[300px] items-center gap-3">
                  <Thumb src={row.photo} alt={tr("{0} photo", { "0": row.item })} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{row.item}</div>
                    <div className="truncate text-[13px] text-ink-muted">{row.category}</div>
                  </div>
                </div>
              </td>
              <td><div className="max-w-[170px] truncate" title={row.storage}>{row.storage || "—"}</div></td>
              <td>
                <div className="max-w-[150px] truncate" title={row.guard}>{row.guard || "—"}</div>
                {row.receipt === "waiting" && <div className="mt-1 text-[12.5px] font-medium text-gold-700">{tr("Not confirmed yet")}</div>}
                {row.receipt === "received" && <div className="mt-1 text-[12.5px] text-mint-700">{tr("Receipt confirmed")}</div>}
              </td>
              <td className="text-right font-semibold tabular-nums text-ink">{row.daysHeld}</td>
              <td>
                <StatusPill tone={STATE_TONE[row.state]}>{row.stateLabel}</StatusPill>
                {row.state === "claim_review" && row.openClaims > 1 && <div className="mt-1 text-[12.5px] text-ink-muted">{tr("{0} claims", { "0": row.openClaims })}</div>}
                {row.state === "claim_review" && row.claimOverdue && (
                  <div className="mt-1 flex items-center gap-1 text-[12.5px] font-medium text-rose-700"><AlarmClock size={13} aria-hidden="true" />{tr("Waiting {0} days", { "0": row.claimWaitingDays })}</div>
                )}
                {row.smartTag && <div className="mt-1 flex items-center gap-1 text-[12.5px] text-iris-700"><Tag size={13} aria-hidden="true" />{tr("Smart Tag {0}", { "0": row.smartTag })}</div>}
              </td>
              <td>
                {step
                  ? <button type="button" onClick={() => onNavigate(step.target)} className={step.target === "auctions" && row.state === "waiting" ? BTN.gold : BTN.ghost}>{step.target === "auctions" ? <Gavel size={15} aria-hidden="true" /> : null}{tr(step.label)}</button>
                  : <span className="text-ink-muted">—</span>}
              </td>
              <td>
                <button type="button" onClick={() => setHistoryOf(row.reference)} className={BTN.ghost} aria-label={tr("Open the handling history of {0}", { "0": row.reference })}>
                  <ScrollText size={15} aria-hidden="true" />{tr("History")}
                </button>
              </td>
            </tr>
          );
        })}
      </DataTable>
      {historyOf && <CustodyHistoryModal reference={historyOf} onClose={() => setHistoryOf(null)} />}
    </div>
  );
}
