import { Banknote, CheckCircle2, Hourglass, TriangleAlert } from "lucide-react";
import EmptyState from "../../components/ui/EmptyState";
import { BTN } from "../../components/ui/primitives";
import { DataTable, StatusPill, type Tone } from "../../components/ui/management";
import { AdminTableSkeleton } from "../../components/LoadingSkeleton";
import { formatDateTime } from "../../utils/countdown";
import { peso, type AwaitingData, type AwaitingItem } from "../../utils/incomeApi";
import { tr } from "../../utils/preferences";
import type { PayableItem } from "./PaymentModals";

const STATE: Record<AwaitingItem["state"], { label: string; tone: Tone }> = {
  released: { label: "Handed over, not paid", tone: "rose" },
  awaiting_pickup: { label: "Waiting for pickup", tone: "gold" },
  pending_approval: { label: "Registered, waiting approval", tone: "iris" },
  registered: { label: "Registered", tone: "slate" },
};

/** Everything that is owed and not yet confirmed. Nothing here is income until an administrator confirms it. */
export default function PaymentsQueue({ data, loading, error, onConfirm }: { data: AwaitingData | null; loading: boolean; error: string; onConfirm: (item: PayableItem) => void }) {
  if (loading && !data) return <AdminTableSkeleton rows={5} />;
  if (error) return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>;
  if (!data || data.items.length === 0) {
    return <EmptyState icon={<CheckCircle2 size={20} />} title={tr("Nothing is waiting for payment confirmation")}>{tr("When an auction has a winner or a priced Smart Tag is registered, it appears here until you confirm the payment.")}</EmptyState>;
  }
  const { totals } = data;
  return (
    <div className="space-y-4">
      {totals.released_unpaid_count > 0 && (
        <p role="alert" className="flex items-start gap-2.5 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-[14px] leading-5 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          {tr("{0} item(s) worth {1} were handed over without a confirmed payment. Confirm them if the money was received.", { "0": totals.released_unpaid_count, "1": peso(totals.released_unpaid) })}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-ink-soft">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><Hourglass size={15} aria-hidden="true" />{tr("{0} waiting, {1} in total", { "0": totals.count, "1": peso(totals.amount) })}</span>
        <span>{tr("Auctions {0} ({1})", { "0": peso(totals.auction), "1": totals.auction_count })}</span>
        <span>{tr("Smart Tags {0} ({1})", { "0": peso(totals.smart_tag), "1": totals.smart_tag_count })}</span>
        {totals.proofs_waiting > 0 && <span className="font-semibold text-gold-800 dark:text-gold-300">{tr("{0} payment receipt(s) sent by payers", { "0": totals.proofs_waiting })}</span>}
      </p>
      <DataTable
        caption={tr("Payments waiting for confirmation")}
        minWidth={860}
        columns={[{ key: "item", label: "Item" }, { key: "payer", label: "Payer" }, { key: "state", label: "Status" }, { key: "since", label: "Since" }, { key: "amount", label: "Amount", className: "text-right" }, { key: "action", label: "" }]}
        isEmpty={false}
        empty=""
      >
        {data.items.map((item) => (
          <tr key={`${item.source}-${item.source_ref}`}>
            <td>
              <span className="block font-semibold text-ink">{item.title}</span>
              <span className="block text-[12.5px] text-ink-muted">{item.source === "auction" ? (item.seller_listing ? tr("Seller's item") : tr("Auction Hall")) : tr("Smart Tag")}{item.reference ? ` · ${item.reference}` : ""}</span>
            </td>
            <td className="text-[13.5px]">{item.payer_name || "—"}</td>
            <td><StatusPill tone={STATE[item.state].tone}>{tr(STATE[item.state].label)}</StatusPill>{item.proof && <span className="mt-1 flex"><StatusPill tone="gold">{tr("Receipt sent: check it")}</StatusPill></span>}</td>
            <td className="whitespace-nowrap text-[13.5px] text-ink-muted">{item.since ? formatDateTime(item.since) : "—"}</td>
            <td className="text-right font-semibold tabular-nums text-ink">{peso(item.amount)}{item.seller_split && <span className="block text-[12px] font-medium text-ink-muted">{tr("office keeps {0}", { "0": peso(item.seller_split.commission) })}</span>}</td>
            <td className="mgmt-actions text-right">
              <button type="button" onClick={() => onConfirm({ source: item.source, source_ref: item.source_ref, title: item.title, amount: item.amount, payer_name: item.payer_name, released: item.released, proof: item.proof, seller_split: item.seller_split })} className={`${BTN.gold} !min-h-[38px]`}>
                <Banknote size={15} aria-hidden="true" />{item.proof ? tr("Review and confirm") : tr("Confirm payment")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
