/** Smart Tags client: the public scan page, registering a tag, and managing your own tags. */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export type PublicTagStatus = "blank" | "pending_verification" | "active" | "lost" | "expired" | "disabled" | "inactive";

export interface PublicTag {
  tag_id: string;
  status: PublicTagStatus;
  item_name?: string;
  item_description?: string;
  /** Short-lived signed link to the photo taken at registration. Absent for tags registered before photos existed. */
  photo_url?: string | null;
  /** Only the details the owner chose to share are present. */
  contact?: { name?: string; email?: string; phone?: string };
  is_owner?: boolean;
}

export interface OwnerTag {
  tag_id: string;
  status: "active" | "lost" | "blank" | "expired" | "pending_verification";
  tag_type?: "qr" | "rfid" | "nfc";
  validity_months?: number | null;
  /** When the tag stops working. Null for tags that never expire. */
  valid_until?: string | null;
  days_left?: number | null;
  item_name: string;
  item_description: string;
  photo_url?: string | null;
  /** The item name cannot be edited by its owner once the tag is registered. */
  item_name_locked?: boolean;
  /** Registered, or given a new photo, and waiting for staff to verify it. */
  awaiting_approval?: boolean;
  /** A new photo is waiting; the previously approved one is still the official photo. */
  photo_pending?: boolean;
  is_reregistration?: boolean;
  show_name: boolean;
  show_email: boolean;
  show_phone: boolean;
  contact_phone: string;
  is_disabled: boolean;
  disabled_reason: string | null;
  claimed_at: string | null;
  found_notice_count: number;
  last_found_notice_at: string | null;
  url: string;
}

export interface TagDetailsInput {
  item_name: string;
  item_description: string;
  show_name: boolean;
  show_email: boolean;
  show_phone: boolean;
  contact_phone: string;
}

export interface FoundResult { success: boolean; notified: boolean; cooldown: boolean; instructions: string[] }

export class TagRequestError extends Error {
  status: number;
  code?: string;
  setupRequired: boolean;
  instructions?: string[];
  constructor(message: string, status: number, extra: { code?: string; setupRequired?: boolean; instructions?: string[] } = {}) {
    super(message);
    this.name = "TagRequestError";
    this.status = status;
    this.code = extra.code;
    this.setupRequired = Boolean(extra.setupRequired);
    this.instructions = extra.instructions;
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const upload = options.body instanceof FormData;
  // A multipart body must not carry our JSON content type: the browser adds the boundary itself.
  const headers: Record<string, string> = upload ? {} : { "Content-Type": "application/json" };
  const token = localStorage.getItem("ebalik_token");
  if (token && options.auth !== false) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/tags${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : upload ? (options.body as FormData) : JSON.stringify(options.body) });
  } catch {
    throw new TagRequestError("Can't reach the server. Check your connection and try again.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TagRequestError(typeof data.error === "string" ? data.error : "Something went wrong.", response.status, {
      code: typeof data.code === "string" ? data.code : undefined,
      setupRequired: Boolean(data.setup_required),
      instructions: Array.isArray(data.instructions) ? data.instructions.filter((line: unknown): line is string => typeof line === "string") : undefined,
    });
  }
  return data as T;
}

export const tagsApi = {
  view: (id: string) => request<PublicTag>(`/${encodeURIComponent(id)}`),
  found: (id: string, input: { message: string; contact: string }) => request<FoundResult>(`/${encodeURIComponent(id)}/found`, { method: "POST", body: input, auth: false }),
  mine: () => request<{ tags: OwnerTag[] }>("/mine"),
  /** Registration is multipart: the details plus the photo taken live with the camera. */
  claim: (id: string, input: TagDetailsInput & { dpa_consent: boolean }, photo: File) => {
    const form = new FormData();
    Object.entries(input).forEach(([key, value]) => form.append(key, String(value)));
    form.append("photo", photo, photo.name || "photo.jpg");
    return request<{ tag: OwnerTag; message: string }>(`/${encodeURIComponent(id)}/claim`, { method: "POST", body: form });
  },
  photo: (id: string, photo: File) => {
    const form = new FormData();
    form.append("photo", photo, photo.name || "photo.jpg");
    return request<{ tag: OwnerTag }>(`/${encodeURIComponent(id)}/photo`, { method: "POST", body: form });
  },
  update: (id: string, input: Partial<TagDetailsInput> & { status?: "active" | "lost" }) => request<{ tag: OwnerTag }>(`/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
};

/** Pull a tag code out of whatever the user pasted: the code itself or the full scan URL. */
export function extractTagCode(value: string): string | null {
  const text = value.trim();
  const fromUrl = text.match(/\/tag\/([A-Za-z0-9]{10,12})(?:[/?#]|$)/);
  const code = (fromUrl ? fromUrl[1] : text.replace(/[\s-]/g, "")).toUpperCase();
  return /^[A-Z0-9]{10,12}$/.test(code) ? code : null;
}

/** Show the owner when a tag expires: "Valid until 5 Oct 2027 (364 days left)". Null for tags that never expire. */
export function expiryText(tag: Pick<OwnerTag, "status" | "valid_until" | "days_left">): string | null {
  if (!tag.valid_until) return null;
  const date = new Date(tag.valid_until);
  if (Number.isNaN(date.getTime())) return null;
  const when = date.toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" });
  if (tag.status === "expired") return `Expired on ${when}`;
  const days = tag.days_left;
  if (days === null || days === undefined) return `Valid until ${when}`;
  if (days <= 0) return `Expires today (${when})`;
  return `Valid until ${when} (${days} ${days === 1 ? "day" : "days"} left)`;
}

/** Group a code in fours so it is easy to read aloud to a guard: ABCD EFGH JK23. */
export const spacedCode = (code: string) => code.replace(/(.{4})/g, "$1 ").trim();

/** Only render links for values that really look like an email address or phone number (never a script URL). */
export const safeMailto = (email: string) => (/^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/.test(email) ? `mailto:${email}` : null);
export const safeTel = (phone: string) => (/^\+?[0-9][0-9 ()\-]{5,18}[0-9]$/.test(phone) ? `tel:${phone.replace(/[^0-9+]/g, "")}` : null);
