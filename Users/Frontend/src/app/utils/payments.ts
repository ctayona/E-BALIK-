/** What a payer owes for an auction win or a Smart Tag, and sending the receipt of a GCash, Maya or bank payment. */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export type PayMethod = "gcash" | "maya" | "bank" | "other";
export const PAY_METHODS: Array<{ value: PayMethod; label: string; hint: string }> = [
  { value: "gcash", label: "GCash", hint: "The reference number is on your GCash receipt." },
  { value: "maya", label: "Maya", hint: "The reference number is on your Maya receipt." },
  { value: "bank", label: "Bank transfer", hint: "Use the transaction or reference number from your bank." },
  { value: "other", label: "Other", hint: "Any number that identifies your payment." },
];

export interface ProofView { proof_id: string; method: string; reference: string; note: string; status: "pending" | "accepted" | "rejected" | "replaced"; created_at: string; review_note: string }
export interface DueItem { source: "auction" | "smart_tag"; source_ref: string; title: string; amount: number; state: "awaiting"; released: boolean; proof: ProofView | null }
export interface MyPayments { items: DueItem[]; instructions: string }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("ebalik_token");
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/payments${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }, cache: "no-store" });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong.");
  return data as T;
}

export const paymentsApi = {
  mine: () => request<MyPayments>("/mine"),
  /** The image is shrunk first (phone screenshots are large); the server checks it again and keeps it private. */
  sendProof: (input: { source: string; source_ref: string; method: PayMethod; reference: string; note: string; image: File }) => {
    const form = new FormData();   // multipart: the browser adds the content type with its boundary
    form.append("source", input.source);
    form.append("source_ref", input.source_ref);
    form.append("method", input.method);
    form.append("reference", input.reference);
    form.append("note", input.note);
    form.append("image", input.image);
    return request<{ message: string; proof: ProofView }>("/proof", { method: "POST", body: form });
  },
};

/** Receipt screenshots stay readable at 1600 px; anything bigger only slows the upload. */
export async function shrinkReceipt(file: File, maxSide = 1600): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) { bitmap.close(); return file; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    return blob ? new File([blob], "receipt.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
