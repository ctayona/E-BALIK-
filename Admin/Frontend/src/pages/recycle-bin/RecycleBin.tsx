import { useCallback, useEffect, useMemo, useState } from "react";
import { ArchiveRestore, Clock3, Inbox, Trash2 } from "lucide-react";
import { fetchRecycleBin, purgeBinItem, restoreBinItem, BinSetupError, type BinItem, type BinType } from "../../utils/recycleBinApi";
import { DataTable, FilterSelect, IconAction, RowActions, SearchField, StatusPill, Toolbar, type Tone } from "../../components/ui/management";
import { PageHeader, BTN } from "../../components/ui/primitives";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { AdminTableSkeleton } from "../../components/LoadingSkeleton";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { formatDateTime } from "../../utils/countdown";
import { tr } from "../../utils/preferences";

const TYPE_LABEL: Record<BinType, string> = { claim: "Claim", found_item: "Found item", missing_item: "Lost report", user: "Account", auction: "Auction", evidence: "ID and photo files" };
const TYPE_TONE: Record<BinType, Tone> = { claim: "iris", found_item: "mint", missing_item: "gold", user: "rose", auction: "iris", evidence: "slate" };
const TABLE_LABEL: Record<string, string> = { user_profiles: "account", found_items: "found item", missing_items: "lost report", claims: "claim", ai_matches: "match", custody_log: "handover log entry", auctions: "auction", auction_bids: "bid", auction_comments: "comment", auction_reactions: "heart" };
const ALL = "all";

/** What came with it, in plain words: "1 account, 2 found items, 3 claims, 5 files". */
function contents(item: BinItem) {
  const parts = Object.entries(item.summary).map(([table, count]) => `${count} ${tr(TABLE_LABEL[table] ?? table)}${count === 1 ? "" : "s"}`);
  if (item.file_count) parts.push(`${item.file_count} ${item.file_count === 1 ? tr("file") : tr("files")}`);
  return parts.join(", ") || "—";
}

type Pending = { kind: "restore" | "purge"; item: BinItem };

export default function RecycleBin() {
  const [items, setItems] = useState<BinItem[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState("");
  const [error, setError] = useState("");
  const [type, setType] = useState(ALL);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await fetchRecycleBin(type === ALL ? "" : type);
      setItems(data.items);
      setDays(data.retention_days);
      setSetup("");
    } catch (failure) {
      if (failure instanceof BinSetupError) setSetup(failure.message);
      else setError(failure instanceof Error ? failure.message : tr("Unable to load the recycle bin."));
    } finally {
      setLoading(false);
    }
  }, [type]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? items.filter((item) => `${item.label} ${item.entity_id} ${item.deleted_by}`.toLowerCase().includes(needle)) : items;
  }, [items, search]);

  const confirm = async (authenticatorCode?: string) => {
    if (!pending || busy) return;
    const { kind, item } = pending;
    setBusy(true);
    try {
      const result = kind === "restore" ? await restoreBinItem(item.archive_id) : await purgeBinItem(item.archive_id, authenticatorCode ?? "");
      setPending(null);
      showInfoModal({ variant: "success", title: kind === "restore" ? "Restored" : "Deleted permanently", message: result.message ?? "Done.", replaceAuto: true });
      await load();
    } catch (failure) {
      setPending(null);
      showInfoModal({ variant: "error", title: kind === "restore" ? "Not restored" : "Not deleted", message: failure instanceof Error ? failure.message : "Something went wrong.", replaceAuto: true });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="space-y-6 p-4 sm:p-6" aria-busy="true"><AdminTableSkeleton columns={6} rows={5} /></div>;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={tr("Recycle bin")}
        description={tr("Deleted records wait here for {0} days. Restore one if it was a mistake, or delete it permanently with your authenticator code. After {0} days it is deleted for good.", { "0": days })}
        meta={<StatusPill tone="slate"><Clock3 size={12} className="mr-1 inline" aria-hidden="true" />{tr("Super admins only")}</StatusPill>}
      />

      {setup && <p role="alert" className="rounded-2xl border border-gold-300 bg-gold-50 px-5 py-4 text-[14px] leading-6 text-ink-soft dark:border-gold-500/30 dark:bg-gold-500/10">{setup}</p>}
      {error && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 text-[14px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-[#fecdd3]">{error} <button type="button" onClick={() => void load()} className="font-semibold underline">{tr("Try again")}</button></p>}

      <Toolbar trailing={(search || type !== ALL) ? <button type="button" onClick={() => { setSearch(""); setType(ALL); }} className={BTN.ghost}>{tr("Clear filters")}</button> : undefined}>
        <SearchField value={search} onChange={setSearch} placeholder={tr("Search by name, reference or who deleted it")} />
        <FilterSelect label={tr("Type")} value={type} onChange={setType} options={[{ value: ALL, label: tr("All types") }, ...(Object.keys(TYPE_LABEL) as BinType[]).map((key) => ({ value: key, label: tr(TYPE_LABEL[key]) }))]} />
      </Toolbar>

      <DataTable
        caption={tr("Deleted records waiting in the recycle bin")}
        columns={[{ key: "type", label: "Type" }, { key: "item", label: "What was deleted" }, { key: "contents", label: "Includes" }, { key: "by", label: "Deleted by" }, { key: "left", label: "Time left" }, { key: "actions", label: "Actions" }]}
        isEmpty={shown.length === 0}
        empty={<><Inbox size={20} className="mx-auto mb-2 text-ink-muted" aria-hidden="true" />{items.length ? tr("Nothing matches your search.") : tr("The recycle bin is empty. Deleted records will appear here.")}</>}
        minWidth={900}
      >
        {shown.map((item) => (
          <tr key={item.archive_id}>
            <td><StatusPill tone={TYPE_TONE[item.entity_type]}>{tr(TYPE_LABEL[item.entity_type])}</StatusPill></td>
            <td className="max-w-[320px]"><div className="truncate font-semibold text-ink" title={item.label}>{item.label}</div><div className="text-[12.5px] text-ink-muted">{formatDateTime(item.deleted_at)}</div></td>
            <td className="max-w-[260px] text-[13px] text-ink-soft">{contents(item)}</td>
            <td className="text-[13px] text-ink-soft">{item.reason === "retention" ? tr("Retention rule") : item.deleted_by}</td>
            <td className="whitespace-nowrap text-[13px] tabular-nums text-ink-soft">{item.days_left == null ? "—" : item.days_left <= 3 ? <span className="font-semibold text-rose-700 dark:text-[#fecdd3]">{tr("{0} days", { "0": item.days_left })}</span> : tr("{0} days", { "0": item.days_left })}</td>
            <RowActions>
              <IconAction label={`${tr("Restore")} ${item.label}`} tone="success" onClick={() => setPending({ kind: "restore", item })} icon={<ArchiveRestore size={17} aria-hidden="true" />} />
              <IconAction label={`${tr("Delete permanently")} ${item.label}`} tone="danger" onClick={() => setPending({ kind: "purge", item })} icon={<Trash2 size={17} aria-hidden="true" />} />
            </RowActions>
          </tr>
        ))}
      </DataTable>

      {pending && (
        <ConfirmActionDialog
          key={`${pending.kind}:${pending.item.archive_id}`}
          title={pending.kind === "restore" ? tr("restore {0}", { "0": pending.item.label }) : tr("delete {0} permanently", { "0": pending.item.label })}
          description={pending.kind === "restore"
            ? tr("It goes back where it was, with its files and everything that was deleted with it.")
            : tr("This cannot be undone. The record and its files are removed for good. Enter the 6 digit code from Google Authenticator.")}
          confirmLabel={pending.kind === "restore" ? "Restore" : "Delete permanently"}
          danger={pending.kind === "purge"}
          requireAuthenticatorCode={pending.kind === "purge"}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={(code) => void confirm(code)}
        />
      )}
    </div>
  );
}
