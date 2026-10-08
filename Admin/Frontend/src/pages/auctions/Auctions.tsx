import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, CheckCheck, Database, Eye, Gavel, PackageCheck, Pencil, Plus, RefreshCw, Timer, Trash2, Trophy } from "lucide-react";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { BTN, PageHeader, RolePill } from "../../components/ui/primitives";
import { DataTable, ExportButton, IconAction, RowActions, SearchField, SegmentedFilter, StatusPill, TableFooter, Thumb, Toolbar, usePagination } from "../../components/ui/management";
import { AuctionSetupError, deleteAdminAuction, fetchAdminAuctions, fetchEligibleAuctionItems, peso, type AdminAuction, type AuctionList } from "../../utils/auctionApi";
import { downloadCsv } from "../../utils/csv";
import { ARCHIVED_TAB, setArchived } from "../../utils/archive";
import { formatDateTime, formatRemaining, serverOffset, useNow } from "../../utils/countdown";
import { canDelete } from "../../utils/permissions";
import { tr } from "../../utils/preferences";
import AuctionFormModal from "./AuctionFormModal";
import AuctionDetailModal, { FINISHED_STAGES, STAGE_TONE, statusLabel } from "./AuctionDetailModal";

const ALL = "__all__";

function SetupNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="glass-panel mx-auto max-w-[680px] p-6 sm:p-8" role="alert">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950"><Database size={22} aria-hidden="true" /></span>
      <h2 className="mt-4 font-[family-name:var(--font-heading)] text-[22px] font-semibold text-ink">{tr("Auction Hall needs one database step")}</h2>
      <p className="mt-2 text-[14.5px] leading-6 text-ink-soft">{tr("The auction tables have not been created in Supabase yet, so nothing can be saved or shown.")}</p>
      <ol className="mt-4 space-y-2 text-[14px] leading-6 text-ink-soft">
        <li>{tr("Open the Supabase dashboard and choose SQL Editor.")}</li>
        <li>{tr("Paste and run the contents of Server/manual_migrations/20261005_auction_hall.sql.")}</li>
        <li>{tr("Come back here and press Check again.")}</li>
      </ol>
      <p className="mt-4 rounded-xl bg-frost-50 px-4 py-3 text-[13px] text-ink-muted">{message}</p>
      <button type="button" onClick={onRetry} className={`${BTN.primary} mt-5`}><RefreshCw size={16} aria-hidden="true" />{tr("Check again")}</button>
    </section>
  );
}

function TimeLeft({ auction, now }: { auction: AdminAuction; now: number }) {
  if (auction.status === "live") {
    const left = new Date(auction.ends_at).getTime() - now;
    const urgent = left > 0 && left < 10 * 60000;
    return <span className={`tabular-nums ${urgent ? "font-semibold text-rose-600" : "text-ink"}`}>{formatRemaining(left) || tr("Closing")}</span>;
  }
  if (auction.status === "scheduled") return <span className="tabular-nums text-ink-soft">{tr("Opens {0}", { "0": formatDateTime(auction.starts_at) })}</span>;
  if (auction.status === "awaiting") return <span className="tabular-nums font-semibold text-iris-700 dark:text-iris-300">{tr("Closed {0}", { "0": formatDateTime(auction.ends_at) })}</span>;
  return <span className="tabular-nums text-ink-muted">{formatDateTime(auction.ended_at ?? auction.ends_at)}</span>;
}

export default function Auctions() {
  const [data, setData] = useState<AuctionList | null>(null);
  const [eligible, setEligible] = useState<number | null>(null);
  const [setupError, setSetupError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(ALL);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [form, setForm] = useState<{ edit?: AdminAuction } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminAuction | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AdminAuction | null>(null);
  const [busy, setBusy] = useState(false);
  const isSuperAdmin = canDelete();
  const now = useNow() + offset;

  const load = useCallback(async () => {
    try {
      const [list, items] = await Promise.all([fetchAdminAuctions(), fetchEligibleAuctionItems().catch(() => null)]);
      setData(list);
      setOffset(serverOffset(list.server_time));
      setEligible(items ? items.recommended_total : null);
      setSetupError("");
      setLoadError("");
    } catch (reason) {
      if (reason instanceof AuctionSetupError) setSetupError(reason.message);
      else setLoadError(reason instanceof Error ? reason.message : tr("Unable to load auctions."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const auctions = data?.auctions ?? [];
  // Archived auctions only appear in the Archived tab; every other tab and count is about work still in play.
  const working = useMemo(() => auctions.filter((a) => !a.archived), [auctions]);
  const counts = useMemo(() => ({
    live: working.filter((a) => a.stage === "live").length,
    scheduled: working.filter((a) => a.stage === "scheduled").length,
    awaiting: working.filter((a) => a.stage === "awaiting_admin").length,
    pickup: working.filter((a) => a.stage === "awaiting_pickup").length,
    completed: working.filter((a) => a.stage === "completed").length,
    closed: working.filter((a) => a.stage === "no_bids" || a.stage === "forfeited" || a.stage === "cancelled").length,
    archived: auctions.filter((a) => a.archived).length,
  }), [auctions, working]);

  const matchesTab = (a: AdminAuction) => {
    if (filter === ARCHIVED_TAB) return Boolean(a.archived);
    if (a.archived) return false;
    if (filter === ALL) return true;
    if (filter === "closed") return a.stage === "no_bids" || a.stage === "forfeited" || a.stage === "cancelled";
    return a.stage === filter;
  };
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return auctions.filter((a) => matchesTab(a) && (!query || `${a.title} ${a.reference} ${a.winner ?? ""} ${a.leader ?? ""}`.toLowerCase().includes(query)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auctions, filter, search]);
  const paging = usePagination(filtered, 12, `${filter}|${search}`);

  const confirmDelete = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      await deleteAdminAuction(deleteTarget.id);
      await load();
    } catch {
      // Reported by the API helper.
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget || busy) return;
    setBusy(true);
    try {
      await setArchived("auction", archiveTarget.id, !archiveTarget.archived);
      await load();
    } catch {
      // Reported by the API helper.
    } finally {
      setBusy(false);
      setArchiveTarget(null);
    }
  };

  const exportCsv = () => downloadCsv("auctions", ["Lot", "Title", "Status", "Starting bid", "Buy Now price", "Current bid", "Bids", "Closes", "Winner", "Pickup"],
    filtered.map((a) => [a.reference, a.title, statusLabel(a), a.starting_price, a.buyout_price ?? "", a.current_price, a.bid_count, a.ends_at, a.winner ?? "", a.fulfillment_status ?? ""]));

  if (loading) {
    return <div className="space-y-5 p-4 sm:p-6" aria-busy="true"><div><SkeletonBlock className="mb-2 h-8 w-48" /><SkeletonBlock className="h-4 w-80" /></div><SkeletonBlock className="h-24 w-full rounded-2xl" /><AdminTableSkeleton columns={7} rows={6} /></div>;
  }

  if (setupError) {
    return (
      <div className="space-y-5 p-4 sm:p-6">
        <PageHeader title={tr("Auctions")} description={tr("Sell items that stay unclaimed after a month in custody.")} meta={<RolePill superAdmin={isSuperAdmin} />} />
        <SetupNotice message={setupError} onRetry={() => { setLoading(true); void load(); }} />
      </div>
    );
  }

  const stats = data?.stats;
  const tabs = [
    { value: ALL, label: "All", count: working.length },
    { value: "live", label: "Live", count: counts.live },
    { value: "awaiting_admin", label: "Awaiting admin", count: counts.awaiting },
    { value: "awaiting_pickup", label: "Awaiting pickup", count: counts.pickup },
    { value: "scheduled", label: "Scheduled", count: counts.scheduled },
    { value: "completed", label: "Completed", count: counts.completed },
    ...(counts.closed ? [{ value: "closed", label: "Closed without a sale", count: counts.closed }] : []),
    { value: ARCHIVED_TAB, label: "Archived", count: counts.archived },
  ];

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={tr("Auctions")}
        description={tr("Sell items that stay unclaimed after {0} days in custody. Set the opening bid, timer and anti-snipe rule, then watch the bidding.", { "0": data?.min_custody_days ?? 30 })}
        meta={<RolePill superAdmin={isSuperAdmin} />}
        actions={<>
          <ExportButton onClick={exportCsv} disabled={!filtered.length} />
          <button type="button" onClick={() => setForm({})} className={BTN.primary}><Plus size={17} aria-hidden="true" />{tr("New auction")}</button>
        </>}
      />

      <section className="glass-panel overflow-hidden" aria-label={tr("Auction summary")}>
        <dl className="grid grid-cols-2 lg:grid-cols-4 [&>*]:border-line max-lg:[&>*:nth-child(-n+2)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:divide-x lg:divide-line">
          {[
            { label: "Live now", value: String(stats?.live ?? 0), hint: stats?.scheduled ? tr("{0} scheduled", { "0": stats.scheduled }) : tr("Open for bids"), icon: <Gavel size={16} aria-hidden="true" /> },
            { label: "Ready to auction", value: eligible === null ? "—" : String(eligible), hint: tr("Recommended: unclaimed over {0} days", { "0": data?.min_custody_days ?? 30 }), icon: <Timer size={16} aria-hidden="true" /> },
            { label: "Needs your decision", value: String(stats?.awaiting_admin ?? counts.awaiting), hint: stats?.awaiting_pickup ? tr("{0} winners to collect", { "0": stats.awaiting_pickup }) : tr("Closed, not confirmed"), icon: <PackageCheck size={16} aria-hidden="true" /> },
            { label: "Sales total", value: peso(stats?.sales_total), hint: tr("{0} bids placed", { "0": stats?.total_bids ?? 0 }), icon: <Trophy size={16} aria-hidden="true" /> },
          ].map((stat) => (
            <div key={stat.label} className="px-5 py-4 sm:px-6 sm:py-5">
              <dt className="flex items-center gap-2 text-[13px] font-medium text-ink-muted"><span className="text-gold-600">{stat.icon}</span>{tr(stat.label)}</dt>
              <dd className="mt-1.5 font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-none tabular-nums text-ink">{stat.value}</dd>
              <p className="mt-1.5 text-[12.5px] text-ink-muted">{stat.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      {loadError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{loadError}</p>}

      <SegmentedFilter label="Status" value={filter} onChange={setFilter} options={tabs} />

      <Toolbar>
        <SearchField value={search} onChange={setSearch} placeholder={tr("Search lot, title or bidder")} />
      </Toolbar>

      <DataTable
        caption={tr("Auctions")}
        minWidth={940}
        columns={[
          { key: "lot", label: "Lot" },
          { key: "bid", label: "Current bid" },
          { key: "who", label: "Leader or winner" },
          { key: "time", label: "Time" },
          { key: "status", label: "Status" },
          { key: "actions", label: "Actions" },
        ]}
        isEmpty={paging.pageItems.length === 0}
        empty={auctions.length === 0 ? (
          <span className="mx-auto block max-w-[46ch] leading-6">{tr("No auctions yet. When an item has been unclaimed for over {0} days, choose New auction to put it up for bidding.", { "0": data?.min_custody_days ?? 30 })}</span>
        ) : tr("Nothing matches these filters. Clear them to see every record.")}
        footer={<TableFooter {...paging} onPage={paging.setPage} />}
      >
        {paging.pageItems.map((auction) => (
          <tr key={auction.id} data-tone={STAGE_TONE[auction.stage]}>
            <td>
              <div className="flex min-w-[230px] max-w-[320px] items-center gap-3">
                <Thumb src={auction.image_url} alt={auction.title} />
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{auction.title}</div>
                  <div className="text-[13px] tabular-nums text-ink-muted">{auction.reference || "—"}</div>
                </div>
              </div>
            </td>
            <td>
              <div className="font-semibold tabular-nums text-ink">{peso(auction.current_price)}</div>
              <div className="text-[13px] text-ink-muted">{auction.bid_count === 0 ? tr("No bids") : tr("{0} bids", { "0": auction.bid_count })}</div>
            </td>
            <td>{auction.winner ?? auction.leader ?? <span className="text-ink-muted">—</span>}{auction.status === "awaiting" && auction.leader && <div className="text-[12.5px] text-ink-muted">{tr("Leading bidder")}</div>}</td>
            <td className="whitespace-nowrap"><TimeLeft auction={auction} now={now} /></td>
            <td>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill tone={STAGE_TONE[auction.stage] ?? "slate"}>{statusLabel(auction)}</StatusPill>
                {auction.bought_out && <StatusPill tone="gold">{tr("Bought with Buy Now")}</StatusPill>}
                {auction.fulfillment_status === "awaiting_pickup" && auction.pickup_warning_sent_at && <StatusPill tone="rose">{tr("Final warning sent")}</StatusPill>}
                {auction.reauction_ready && <StatusPill tone="rose">{tr("Ready for re-auction")}</StatusPill>}
                {auction.pending_claim && <StatusPill tone="gold">{tr("Ownership claim pending")}</StatusPill>}
              </div>
            </td>
            <RowActions>
              <IconAction label={`${tr("View")} ${auction.reference || auction.title}`} onClick={() => setDetailId(auction.id)} icon={<Eye size={17} aria-hidden="true" />} />
              {auction.status === "awaiting" && <IconAction label={`${tr("Review result")} ${auction.reference || auction.title}`} tone="success" onClick={() => setDetailId(auction.id)} icon={<CheckCheck size={17} aria-hidden="true" />} />}
              {(auction.stage === "live" || auction.stage === "scheduled" || auction.stage === "awaiting_admin" || auction.stage === "awaiting_pickup") && <IconAction label={`${tr("Edit")} ${auction.reference || auction.title}`} tone="gold" onClick={() => setForm({ edit: auction })} icon={<Pencil size={16} aria-hidden="true" />} />}
              {FINISHED_STAGES.includes(auction.stage) && !auction.archived && <IconAction label={`${tr("Archive")} ${auction.reference || auction.title}`} onClick={() => setArchiveTarget(auction)} icon={<Archive size={16} aria-hidden="true" />} />}
              {auction.archived && <IconAction label={`${tr("Restore from archive")} ${auction.reference || auction.title}`} tone="success" onClick={() => setArchiveTarget(auction)} icon={<ArchiveRestore size={16} aria-hidden="true" />} />}
              {isSuperAdmin && auction.status !== "live" && auction.status !== "scheduled" && auction.status !== "awaiting" && auction.fulfillment_status !== "awaiting_pickup" && (
                <IconAction label={`${tr("Delete")} ${auction.reference || auction.title}`} tone="danger" onClick={() => setDeleteTarget(auction)} icon={<Trash2 size={16} aria-hidden="true" />} />
              )}
            </RowActions>
          </tr>
        ))}
      </DataTable>

      {form && (form.edit
        ? <AuctionFormModal mode="edit" auction={form.edit} onClose={() => setForm(null)} onSaved={() => { void load(); }} />
        : <AuctionFormModal mode="create" onClose={() => setForm(null)} onSaved={() => { void load(); }} />)}

      {detailId && (
        <AuctionDetailModal
          id={detailId}
          canDelete={isSuperAdmin}
          onClose={() => setDetailId(null)}
          onEdit={(auction) => { setDetailId(null); setForm({ edit: auction }); }}
          onChanged={() => { void load(); }}
        />
      )}

      {archiveTarget && (
        <ConfirmActionDialog
          title={archiveTarget.archived ? tr("restore auction {0} from the archive?", { "0": archiveTarget.reference || archiveTarget.title }) : tr("archive auction {0}?", { "0": archiveTarget.reference || archiveTarget.title })}
          description={archiveTarget.archived ? tr("It goes back to the working list.") : tr("It moves out of the working list into the Archived tab. Nothing is deleted and you can restore it any time.")}
          confirmLabel={archiveTarget.archived ? tr("Restore") : tr("Archive")}
          busy={busy}
          onCancel={() => { if (!busy) setArchiveTarget(null); }}
          onConfirm={() => void confirmArchive()}
        />
      )}

      {deleteTarget && (
        <ConfirmActionDialog
          title={tr("delete auction {0}?", { "0": deleteTarget.reference || deleteTarget.title })}
          description="This moves the auction, its bids and its comments to the Recycle bin. A super admin can restore them."
          confirmLabel="Delete auction"
          danger
          busy={busy}
          onCancel={() => { if (!busy) setDeleteTarget(null); }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
