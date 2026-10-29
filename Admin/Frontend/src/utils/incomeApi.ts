import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";

/** Revenue and payments: the income ledger plus payment confirmation (migrations 20261022 and 20261024). Reads throw `IncomeSetupError` until the ledger exists. */

/** How income is reported. "commission" is what the office kept from items people listed themselves (a seller's auction). */
export type IncomeSource = "auction" | "smart_tag" | "commission" | "other";
/** "payout" is a seller's share of a sale: written with the sale so it never counts as the office's income. */
export type IncomeKind = "sale" | "refund" | "adjustment" | "payout";
export type IncomeMethod = "cash" | "gcash" | "maya" | "bank" | "other";

export interface IncomeMonth { month: string; auction: number; smart_tag: number; commission?: number; other: number; total: number }
export interface IncomePending {
  /** Auction wins and registered priced tags whose payment an administrator has not confirmed yet. */
  auction: number; auction_count: number;
  smart_tag: number; smart_tag_count: number;
  /** Auctions already handed over without a confirmed payment. */
  released_unpaid: number; released_unpaid_count: number;
  /** Unsold blank tags and what they would bring in at their current price. */
  stock_value: number; stock_count: number;
}
export interface IncomeSummary {
  range: { start: string; end: string };
  total: number;
  by_source: Record<IncomeSource, number>;
  refunds: number;
  entries: number;
  sales: number;
  average_sale: number;
  by_method: Record<IncomeMethod, number>;
  reversals: number;
  this_month: number;
  previous_month: number;
  by_month: IncomeMonth[];
  pending: IncomePending;
  /** Seller auctions in the period: what buyers paid, what the office kept, what belongs to sellers, and what is still held for them (all time). */
  seller?: { gross: number; commission: number; shares: number; sales: number; owed: number };
  sources: Record<IncomeSource, string>;
  methods: Record<IncomeMethod, string>;
}
export interface IncomeEntry {
  entry_id: string;
  source: IncomeSource;
  /** Where the row is reported: a seller's auction shows as "commission". */
  report_source?: IncomeSource;
  kind_label?: string;
  kind: IncomeKind;
  source_ref: string | null;
  description: string;
  amount: number;
  method: IncomeMethod;
  receipt_no: string | null;
  notes: string | null;
  payment_reference?: string | null;
  reversed?: boolean;
  received_at: string;
  payer_name: string;
  recorded_by_name: string;
}
export interface ManualEntryInput {
  kind: IncomeKind;
  source: IncomeSource;
  amount: string;
  description: string;
  method: IncomeMethod;
  receipt_no: string;
  notes: string;
  received_on: string;
  source_ref: string;
}

export class IncomeSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncomeSetupError";
  }
}

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== "") search.set(key, String(value)); });
  return search.size ? `?${search}` : "";
}

async function read<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin/income/${path}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503 && payload.setup_required) throw new IncomeSetupError(String(payload.error));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load income");
  }
  return payload as T;
}

export const fetchIncomeSummary = (start = "", end = "") => read<IncomeSummary>(`summary${query({ start, end })}`);
export const fetchIncomeEntries = (start = "", end = "", source = "", limit = 25, offset = 0) =>
  read<{ entries: IncomeEntry[]; total: number; limit: number; offset: number }>(`entries${query({ start, end, source, limit, offset })}`);

export async function addIncomeEntry(input: ManualEntryInput) {
  const response = await adminMutationRequest(`${API_URL}/api/admin/income/entries`, {
    method: "POST", headers: getAuthHeaders(), body: JSON.stringify(input),
  }, "Record income entry");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to record the entry");
  return payload as { success: boolean; entry: IncomeEntry };
}

/** Downloads the ledger as a CSV file (opens in Excel with the peso sign intact). */
export async function downloadIncomeCsv(start = "", end = "", source = "") {
  const response = await fetch(`${API_URL}/api/admin/income/export${query({ start, end, source })}`, { headers: getAuthHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to export the income ledger");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `ebalik-income-${start || "start"}-to-${end || "today"}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const peso = (value: number) => `${value < 0 ? "−" : ""}₱${Math.abs(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One thing that is owed: an auction win or a registered, priced Smart Tag. */
export interface AwaitingItem {
  source: "auction" | "smart_tag"; source_ref: string; title: string; reference: string; payer_account_id: string; payer_name: string; amount: number;
  /** The item was already handed over but nobody confirmed the payment. */
  released: boolean; state: "released" | "awaiting_pickup" | "pending_approval" | "registered"; since: string | null;
  /** The receipt image the payer sent (GCash, Maya or bank), waiting for an administrator to check it. */
  proof: PaymentProof | null;
  /** A seller's item: what the office keeps and what is paid out to the seller. */
  seller_listing?: boolean;
  seller_split?: { commission: number; share: number; rate: number } | null;
}
export interface PaymentProof { proof_id: string; method: IncomeMethod; reference: string; note: string; status: "pending" | "accepted" | "rejected" | "replaced"; created_at: string; review_note: string }
export interface AwaitingData {
  items: AwaitingItem[];
  totals: { count: number; amount: number; auction: number; auction_count: number; smart_tag: number; smart_tag_count: number; released_unpaid: number; released_unpaid_count: number; proofs_waiting: number };
}
export type PaymentStatus =
  | { state: "confirmed"; receipt_no: string; amount: number; method: IncomeMethod; entry_id: string }
  | { state: "awaiting"; amount: number; title: string; payer_name: string; released: boolean; proof: PaymentProof | null }
  | { state: "none"; reason: string };

/** The receipt of a confirmed payment, as the administrator sees it (the payer sees the same thing in My receipts). */
export interface PaymentReceipt {
  kind: "payment" | "claim" | "auction" | "payout"; receipt_no: string; code: string; released_at: string; item: { name: string; reference: string }; reference: string;
  released_to: string; campus_id: string; released_by: string; amount: number | null; method?: IncomeMethod; payment_reference?: string; reversed?: boolean;
  /** Payment receipts: a payment receipt image is kept with it, and the ledger entry it belongs to. */
  has_proof?: boolean; entry_id?: string;
  /** Payout receipts (money sent to a seller): the sale, the office fee and the payout id. */
  gross?: number; commission?: number; commission_rate?: number; payout_id?: string;
}
/** One line of the receipts register. The verification code is not in the list: open the receipt to see it. */
export interface ReceiptRow {
  kind: "payment" | "claim" | "auction" | "payout"; id: string; receipt_no: string; item: string; person: string; amount: number | null; method: IncomeMethod | null;
  has_proof: boolean; issued_by: string; released_at: string | null; status: "valid" | "reversed";
}
export interface ReceiptList { receipts: ReceiptRow[]; total: number; counts: Record<"payment" | "claim" | "auction" | "payout", number>; limit: number; offset: number }
export interface ReceiptHistory { who: string | null; action: string; details: string | null; at: string; result: string }
export interface ActivityRow { log_id: string; user_name: string; action: string; target_name: string | null; target_id: string | null; result: string; created_at: string }

async function send<T>(path: string, method: "POST", title: string, body: unknown): Promise<T> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/income/${path}`, { method, headers: getAuthHeaders(), body: JSON.stringify(body) }, title);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `${title} failed`);
  return payload as T;
}

export const fetchAwaiting = () => read<AwaitingData>("payments/awaiting");
export const fetchPaymentStatus = (source: string, ref: string) => read<PaymentStatus>(`payments/status${query({ source, ref })}`);
export const fetchEntryReceipt = async (entryId: string) => (await read<{ receipt: PaymentReceipt }>(`entries/${encodeURIComponent(entryId)}/receipt`)).receipt;
export const fetchIncomeActivity = async () => (await read<{ activity: ActivityRow[] }>("activity?limit=150")).activity;

/** Confirm a payment. `proofFile` is the payer's receipt image the administrator attaches; `proofId` uses the one the payer already sent. */
export interface ConfirmPaymentInput { source: string; source_ref: string; method: IncomeMethod; reference: string; notes: string; expected_amount: number; proofFile?: File | null; proofId?: string | null }
export async function confirmPayment(input: ConfirmPaymentInput): Promise<{ message: string; receipt: PaymentReceipt }> {
  const form = new FormData();   // a multipart body must not carry our JSON content type: the browser adds the boundary
  (["source", "source_ref", "method", "reference", "notes"] as const).forEach((key) => form.append(key, input[key]));
  form.append("expected_amount", String(input.expected_amount));
  if (input.proofId) form.append("proof_id", input.proofId);
  if (input.proofFile) form.append("proof", input.proofFile);
  const token = localStorage.getItem("ebalik_admin_token");
  const response = await adminMutationRequest(`${API_URL}/api/admin/income/payments/confirm`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form }, "Confirm payment");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Confirm payment failed");
  return payload;
}
export const fetchProofUrl = async (proofId: string) => (await read<{ url: string }>(`payments/proofs/${encodeURIComponent(proofId)}/image`)).url;
export const fetchEntryProofUrl = async (entryId: string) => (await read<{ url: string }>(`entries/${encodeURIComponent(entryId)}/proof`)).url;
export const rejectProof = (proofId: string, reason: string) => send<{ message: string }>(`payments/proofs/${encodeURIComponent(proofId)}/reject`, "POST", "Reject payment receipt", { reason });
export const fetchReceipts = (filters: { kind?: string; q?: string; status?: string; start?: string; end?: string }, limit = 25, offset = 0) => read<ReceiptList>(`receipts${query({ ...filters, limit, offset })}`);
export const fetchReceiptDetail = (kind: string, id: string) => read<{ receipt: PaymentReceipt; history: ReceiptHistory[] }>(`receipts/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
export const resendReceipt = (entryId: string) => send<{ message: string }>(`receipts/payment/${encodeURIComponent(entryId)}/resend`, "POST", "Send receipt again", {});
export const fetchInstructions = async () => (await read<{ text: string }>("instructions")).text;
export async function saveInstructions(text: string): Promise<string> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/income/instructions`, { method: "PUT", headers: getAuthHeaders(), body: JSON.stringify({ text }) }, "Save payment instructions");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to save the instructions");
  return String(payload.text ?? "");
}
/** Needs the 6-digit Google Authenticator code of the super administrator. */
export const reversePayment = (entryId: string, reason: string, authenticatorCode: string) => send<{ message: string }>(`entries/${encodeURIComponent(entryId)}/reverse`, "POST", "Reverse payment", { reason, authenticator_code: authenticatorCode });

const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));

/** A clean one-page official receipt in a new window and the print dialog ("Save as PDF" is one of the choices). Returns false if pop-ups are blocked. */
export function printPaymentReceipt(receipt: PaymentReceipt): boolean {
  const methods: Record<string, string> = { cash: "Cash", gcash: "GCash", maya: "Maya", bank: "Bank transfer", other: "Other" };
  const when = new Date(receipt.released_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const payment = receipt.kind === "payment";
  const payout = receipt.kind === "payout";
  const title = payment ? "Official payment receipt" : payout ? "Seller payout receipt" : receipt.kind === "auction" ? "Auction collection receipt" : "Handover receipt";
  const php = (value: number) => peso(value).replace("₱", "PHP ");
  const rows: Array<[string, string]> = [
    ["Item", receipt.item.name], [payment ? "Received from" : payout ? "Paid to" : "Released to", receipt.released_to || "-"], ...(receipt.campus_id ? [["Campus ID", receipt.campus_id] as [string, string]] : []),
    ...(payout && receipt.gross ? [["Sold for", php(receipt.gross)] as [string, string], [`Office fee (${receipt.commission_rate ?? 0}%)`, php(receipt.commission ?? 0)] as [string, string]] : []),
    ...(receipt.amount ? [[payment ? "Amount received" : payout ? "Amount sent to the seller" : "Amount paid", php(receipt.amount)] as [string, string]] : []),
    ...((payment || payout) && receipt.method ? [[payout ? "Sent by" : "Paid by", methods[receipt.method] ?? receipt.method] as [string, string]] : []),
    ...(receipt.payment_reference ? [[payout ? "Transfer reference" : "Payment reference", receipt.payment_reference] as [string, string]] : []), ["Date and time", when], [payment ? "Received by" : payout ? "Paid by" : "Released by", receipt.released_by],
  ];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(receipt.receipt_no)}</title><style>
    @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Geist:wght@400..700&family=Geist+Mono:wght@500&display=swap');
    body{font-family:'Geist',Arial,sans-serif;color:#0f172a;margin:0;padding:32px;background:#fff}
    .sheet{max-width:640px;margin:0 auto;border:1.5px solid #1f3160;border-radius:14px;overflow:hidden;position:relative}
    .top{background:#1f3160;color:#fff;padding:22px 26px;border-bottom:4px solid #d1a153}.top small{color:#ecc787;font-size:13px;font-weight:600}
    .top h1{font-family:'Bricolage Grotesque',Georgia,serif;font-size:26px;margin:4px 0 0}
    .no{padding:22px 26px 6px}.no span{display:block;font-size:12.5px;color:#64748b;font-weight:600}.no strong{font-family:'Geist Mono',monospace;font-size:22px;color:#1f3160}
    .code{margin:10px 26px 4px;padding:12px 16px;border:2px dashed #d1a153;border-radius:10px;background:#fdf8ee;display:flex;justify-content:space-between;align-items:center}
    .code span{font-size:12.5px;color:#8f6526;font-weight:600}.code strong{font-family:'Geist Mono',monospace;font-size:21px;letter-spacing:.12em;color:#1f3160}
    dl{margin:16px 26px;display:grid;grid-template-columns:160px 1fr;gap:9px 14px;font-size:14px}dt{color:#64748b;font-weight:600}dd{margin:0;font-weight:600}
    .foot{margin:0 26px 24px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:12.5px;line-height:1.6;color:#475569}
    .void{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:84px;font-weight:700;color:rgba(225,29,72,.18);transform:rotate(-18deg);pointer-events:none}
    @media print{body{padding:0}}</style></head><body><div class="sheet">${receipt.reversed ? '<div class="void">REVERSED</div>' : ""}
    <div class="top"><small>University of Makati - Lost and Found Office</small><h1>${escapeHtml(title)}</h1></div>
    <div class="no"><span>Receipt number</span><strong>${escapeHtml(receipt.receipt_no)}</strong></div>
    <div class="code"><span>Verification code</span><strong>${escapeHtml(receipt.code)}</strong></div>
    <dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>
    <p class="foot">${receipt.reversed ? "This payment was reversed by the office. This receipt is no longer valid. " : ""}To check that this receipt is genuine, open E-Balik, choose Claims, then Check a receipt, and enter the receipt number and verification code.</p>
    </div></body></html>`;
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 400);
  return true;
}
