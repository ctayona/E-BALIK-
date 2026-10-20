import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import EmptyState from "../../components/ui/EmptyState";
import { DataTable, StatusPill, type Tone } from "../../components/ui/management";
import { AdminTableSkeleton } from "../../components/LoadingSkeleton";
import { formatDateTime } from "../../utils/countdown";
import { fetchIncomeActivity, type ActivityRow } from "../../utils/incomeApi";
import { tr } from "../../utils/preferences";

const TONE: Record<string, Tone> = { "Confirm Payment": "mint", "Reverse Payment": "rose", "Record Income Entry": "gold", "Export Income Ledger": "slate" };

/** Who confirmed, reversed, recorded or exported what, and when. Written by the server, so it cannot be skipped. */
export default function ActivityLog({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    fetchIncomeActivity().then((data) => { if (live) { setRows(data); setError(""); } }).catch((failure) => { if (live) setError(failure instanceof Error ? failure.message : tr("Unable to load the log.")); });
    return () => { live = false; };
  }, [refreshKey]);
  if (error) return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>;
  if (!rows) return <AdminTableSkeleton rows={6} />;
  if (rows.length === 0) return <EmptyState icon={<ScrollText size={20} />} title={tr("No payment activity yet")}>{tr("Confirmations, reversals, manual entries and exports are listed here with who did them.")}</EmptyState>;
  return (
    <DataTable
      caption={tr("Revenue activity log")}
      minWidth={820}
      columns={[{ key: "when", label: "When" }, { key: "who", label: "Administrator" }, { key: "action", label: "Action" }, { key: "what", label: "Details" }, { key: "ref", label: "Reference" }]}
      isEmpty={false}
      empty=""
    >
      {rows.map((row) => (
        <tr key={row.log_id}>
          <td className="whitespace-nowrap text-[13.5px]">{formatDateTime(row.created_at)}</td>
          <td className="text-[13.5px]">{row.user_name}</td>
          <td><StatusPill tone={row.result === "failed" ? "rose" : TONE[row.action] ?? "iris"}>{row.action}</StatusPill></td>
          <td className="max-w-[420px] text-[13.5px] text-ink-soft">{row.target_name || "—"}</td>
          <td className="font-mono text-[12.5px] text-ink-muted">{row.target_id || "—"}</td>
        </tr>
      ))}
    </DataTable>
  );
}
