/** Digital handover receipts: the owner's proof that an item was released to them, and a public check that a receipt is genuine. */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export interface Receipt {
  kind: "claim" | "auction" | "payment" | "payout";
  receipt_no: string;
  /** Ten characters (XXXXX-XXXXX) that only the server can produce. Anyone with the number and this code can check the receipt. */
  code: string;
  released_at: string;
  item: { name: string; reference: string; category: string; found_at: string };
  reference: string;
  released_to: string;
  campus_id: string;
  released_by: string;
  amount: number | null;
  /** Payment receipts only: how it was paid, the payer's reference number, and whether the office reversed it. */
  method?: string;
  payment_reference?: string;
  reversed?: boolean;
  /** Payout receipts only (money the office sent a seller): what the item sold for and the office fee kept. */
  gross?: number;
  commission?: number;
  commission_rate?: number;
}

/** The receipt's heading, its people labels and what it proves, by kind. */
export const RECEIPT_COPY: Record<Receipt["kind"], { title: string; to: string; by: string; amount: string; proves: string; checked: string }> = {
  claim: { title: "Handover receipt", to: "Released to", by: "Released by", amount: "Amount paid", proves: "This receipt proves the item above was released to the person named.", checked: "was released to its owner" },
  auction: { title: "Auction collection receipt", to: "Released to", by: "Released by", amount: "Amount paid", proves: "This receipt proves the item above was released to the person named.", checked: "was collected from the Auction Hall" },
  payment: { title: "Official payment receipt", to: "Received from", by: "Received by", amount: "Amount paid", proves: "This receipt proves the payment above was received by the Lost and Found Office.", checked: "was paid for and the payment was received" },
  payout: { title: "Seller payout receipt", to: "Paid to", by: "Paid by", amount: "Amount sent to you", proves: "This receipt proves the Lost and Found Office sent the seller the amount above for an item sold in the Auction Hall.", checked: "sold in the Auction Hall and the seller was paid" },
};

export type ReceiptCheck = { valid: false } | { valid: true; kind: "claim" | "auction" | "payment" | "payout"; item_name: string; released_on: string; reversed?: boolean };

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem("ebalik_token");
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/receipts${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }, cache: "no-store" });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong.");
  return data as T;
}

export const receiptsApi = {
  mine: async () => (await request<{ receipts: Receipt[] }>("")).receipts,
  check: (receipt_no: string, code: string) => request<ReceiptCheck>("/verify", { method: "POST", body: JSON.stringify({ receipt_no, code }) }, false),
};

export const manilaDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

export const pesoText = (value: number) => `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));

/** Opens a clean one-page receipt in a new window and the print dialog, where "Save as PDF" is one of the choices. Returns false if pop-ups are blocked. */
export function printReceipt(receipt: Receipt): boolean {
  const rows: Array<[string, string]> = [
    ["Item", receipt.item.name],
    ...(receipt.item.reference && receipt.kind !== "payment" ? [[receipt.kind === "payout" ? "Auction" : "Item reference", receipt.item.reference] as [string, string]] : []),
    ...(receipt.item.found_at ? [["Found at", receipt.item.found_at] as [string, string]] : []),
    [RECEIPT_COPY[receipt.kind].to, receipt.released_to || "-"],
    ...(receipt.campus_id ? [["Campus ID", receipt.campus_id] as [string, string]] : []),
    [RECEIPT_COPY[receipt.kind].by, receipt.released_by],
    ["Date and time", manilaDateTime(receipt.released_at)],
    ...(receipt.kind === "payout" && receipt.gross ? [["Sold for", pesoText(receipt.gross)] as [string, string], [`Office fee (${receipt.commission_rate ?? 0}%)`, pesoText(receipt.commission ?? 0)] as [string, string]] : []),
    ...(receipt.amount ? [[RECEIPT_COPY[receipt.kind].amount, pesoText(receipt.amount)] as [string, string]] : []),
    ...((receipt.kind === "payment" || receipt.kind === "payout") && receipt.method ? [[receipt.kind === "payout" ? "Sent by" : "Paid by", { cash: "Cash", gcash: "GCash", maya: "Maya", bank: "Bank transfer", other: "Other" }[receipt.method] ?? receipt.method] as [string, string]] : []),
    ...(receipt.payment_reference ? [["Payment reference", receipt.payment_reference] as [string, string]] : []),
  ];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(receipt.receipt_no)}</title><style>
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Hanken+Grotesk:wght@400..700&family=DM+Mono:wght@500&display=swap');
    body{font-family:'Hanken Grotesk',Arial,sans-serif;color:#0f172a;margin:0;padding:32px;background:#fff}
    .sheet{max-width:640px;margin:0 auto;border:1.5px solid #1f3160;border-radius:14px;overflow:hidden}
    .top{background:#1f3160;color:#fff;padding:22px 26px;border-bottom:4px solid #d1a153}
    .top small{color:#ecc787;font-size:13px;font-weight:600}.top h1{font-family:'Fraunces',Georgia,serif;font-size:26px;margin:4px 0 0;font-weight:600}
    .no{padding:22px 26px 6px}.no span{display:block;font-size:12.5px;color:#64748b;font-weight:600}
    .no strong{font-family:'DM Mono',monospace;font-size:24px;letter-spacing:.02em;color:#1f3160}
    .code{margin:10px 26px 4px;padding:12px 16px;border:2px dashed #d1a153;border-radius:10px;background:#fdf8ee;display:flex;justify-content:space-between;align-items:center;gap:12px}
    .code span{font-size:12.5px;color:#8f6526;font-weight:600}.code strong{font-family:'DM Mono',monospace;font-size:22px;letter-spacing:.12em;color:#1f3160}
    dl{margin:16px 26px;display:grid;grid-template-columns:150px 1fr;gap:9px 14px;font-size:14px}dt{color:#64748b;font-weight:600}dd{margin:0;font-weight:600}
    .foot{margin:0 26px 24px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:12.5px;line-height:1.6;color:#475569}
    .void{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:84px;font-weight:700;color:rgba(225,29,72,.18);transform:rotate(-18deg);pointer-events:none}
    .sheet{position:relative}
    @media print{body{padding:0}}</style></head><body><div class="sheet">${receipt.reversed ? '<div class="void">REVERSED</div>' : ""}
    <div class="top"><small>University of Makati - Lost and Found Office</small><h1>${RECEIPT_COPY[receipt.kind].title}</h1></div>
    <div class="no"><span>Receipt number</span><strong>${escapeHtml(receipt.receipt_no)}</strong></div>
    <div class="code"><span>Verification code</span><strong>${escapeHtml(receipt.code)}</strong></div>
    <dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>
    <p class="foot">${receipt.reversed ? "This payment was reversed by the office and this receipt is no longer valid. " : ""}${RECEIPT_COPY[receipt.kind].proves} To check that it is genuine, open E-Balik, choose Claims, then Check a receipt, and enter the receipt number and verification code. Keep this receipt private.</p>
    </div></body></html>`;
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 400);
  return true;
}
