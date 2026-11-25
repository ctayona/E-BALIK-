/** Smart Tags client: the public scan page, registering a tag, and managing your own tags. */
import type { NfcPayload } from "./nfc";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/** Other ways a finder may be offered to reach the owner. The owner saves each once (Profile) and switches them on per tag. */
export type ContactKind = "phone2" | "email" | "messenger" | "facebook" | "twitter" | "instagram" | "telegram" | "whatsapp";
export type ContactMethods = Record<ContactKind, string>;
export const CONTACT_KINDS: Array<{ kind: ContactKind; label: string; placeholder: string; hint: string; inputMode?: "tel" | "text" | "email"; main?: boolean }> = [
  { kind: "phone2", label: "Phone number", placeholder: "0917 123 4567", hint: "A number finders can call or text. A parent's or work phone is fine.", inputMode: "tel", main: true },
  { kind: "email", label: "Email address", placeholder: "name@umak.edu.ph", hint: "An email address finders can write to.", inputMode: "email", main: true },
  { kind: "facebook", label: "Facebook", placeholder: "your.username or facebook.com/your.username", hint: "Your Facebook profile link or username.", main: true },
  { kind: "messenger", label: "Messenger", placeholder: "your.username or m.me/your.username", hint: "Your Facebook username or your m.me link.", main: true },
  { kind: "twitter", label: "X (Twitter)", placeholder: "@your_handle or x.com/your_handle", hint: "Your X handle, with or without the @.", main: true },
  { kind: "instagram", label: "Instagram", placeholder: "your_username", hint: "Your Instagram username, without the @." },
  { kind: "telegram", label: "Telegram", placeholder: "your_username or t.me/your_username", hint: "Your Telegram username." },
  { kind: "whatsapp", label: "WhatsApp", placeholder: "+63 917 123 4567", hint: "Your WhatsApp number with the country code.", inputMode: "tel" },
];

/** Owner choices kept next to the contact methods: how their name appears to a finder, and the language of their scan page. */
export interface TagSettings { name_display: "full" | "initials"; language: "en" | "fil" }
export const DEFAULT_TAG_SETTINGS: TagSettings = { name_display: "full", language: "en" };

export type PublicTagStatus = "blank" | "pending_verification" | "active" | "lost" | "expired" | "disabled" | "inactive";

export interface SharedScan {
  scan_id:string; tag_id:string; scanned_at:string; expires_at:string; version:number;
  admin_consent:boolean; owner_consent:boolean; shared_at?:string; withdrawn_at?:string; resolved_at?:string;
  venue?:string; drop_off?:string; latitude?:number; longitude?:number; accuracy?:number;
  captured_at?:string; location_expires_at?:string;
}

export interface PublicTag {
  scan_logging?: boolean;
  scan_receipt?: ScanReceipt;
  scan_recording_failed?:boolean;
  recovery?: boolean;
  tag_id: string;
  status: PublicTagStatus;
  /** Blank tags only: what registering it costs, paid at the office when staff approve it (0 = free). */
  price?: number;
  item_name?: string;
  item_description?: string;
  /** Short-lived signed link to the photo taken at registration. Absent for tags registered before photos existed. */
  photo_url?: string | null;
  /** Only the details the owner chose to share are present. */
  contact?: { name?: string; email?: string; phone?: string; /** Links the owner chose to show, already built by the server (https or tel only). */ links?: Array<{ kind: string; label: string; url: string }> };
  is_owner?: boolean;
  /** The language the owner chose for this page. */
  language?: "en" | "fil";
}

export interface OwnerTag {
  recovery?: boolean;
  tag_id: string;
  /** Set only on the answer to marking a tag lost: the missing report posted for it. */
  lost_report?: string | null;
  /** Set only on the answer to marking a tag found: the missing reports that were closed. */
  closed_reports?: string[];
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
  /** Price of the tag in pesos (0 = free) and whether it has been paid at the office. */
  price?: number;
  paid?: boolean;
  /** A new photo is waiting; the previously approved one is still the official photo. */
  photo_pending?: boolean;
  is_reregistration?: boolean;
  show_name: boolean;
  show_email: boolean;
  show_phone: boolean;
  contact_phone: string;
  /** The saved contact methods this tag shows to a finder. */
  shown_contacts?: ContactKind[];
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
  shown_contacts?: ContactKind[];
}

export interface SharedPoint { latitude: number; longitude: number; accuracy: number; captured_at: string; consent_version: "finder-v1" }
export interface FinderDetails { request_id: string; venue: string; point: SharedPoint | null }
export interface RecoveryReport {reference?: string | null; report_id: string; created_at: string; venue: string | null; note: string; contact: string; received_at: string | null; returned_at: string | null; review: string; point: (Omit<SharedPoint, "consent_version"> & {expires_at: string}) | null}

export interface FoundResult { saved?: boolean; replayed?: boolean; success: boolean; notified: boolean; emailed?: boolean; cooldown: boolean; instructions: string[] }

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

export interface ScanReceipt {scan_id:string;token:string;scanned_at?:string}

export function newScanReceipt():ScanReceipt {
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
  return {scan_id:`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`,
    token:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("")};
}

async function request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean; headers?:Record<string,string> } = {}): Promise<T> {
  const upload = options.body instanceof FormData;
  // A multipart body must not carry our JSON content type: the browser adds the boundary itself.
  const headers: Record<string, string> = upload ? {} : { "Content-Type": "application/json" };
  Object.assign(headers,options.headers);
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
  nfc: (id: string, offlineContact = false) => request<NfcPayload>(`/${encodeURIComponent(id)}/nfc`, { method: "POST", body: { offline_contact: offlineContact } }),
  view: async(id: string,receipt?:ScanReceipt) => {
    try { return await request<PublicTag>(`/${encodeURIComponent(id)}`,{headers:receipt?{'X-Tag-Scan-Id':receipt.scan_id,'X-Tag-Scan-Token':receipt.token}:undefined}); }
    catch(error) {
      // Older backend instances may not yet allow the receipt headers during rollout.
      if(receipt&&error instanceof TagRequestError&&error.status===0)return request<PublicTag>(`/${encodeURIComponent(id)}`);
      throw error;
    }
  },
  recordScan: (id: string, body: { scan_id: string; token: string }) => request<{ scan_id: string; scanned_at: string }>(`/${encodeURIComponent(id)}/scan`, {method:"POST",body,auth:false}),
  shareScan: (id: string, body: Record<string,unknown>, action: "share" | "withdraw" = "share") => request(`/${encodeURIComponent(id)}/scan/${action}`, {method:"POST",body,auth:false}),
  scanHistory: (id: string) => request<{available:boolean;scans:SharedScan[]}>(`/${encodeURIComponent(id)}/scans`),
  found: (id: string, input: { message: string; contact: string } & Partial<FinderDetails>) => request<FoundResult>(`/${encodeURIComponent(id)}/found`, { method: "POST", body: input, auth: false }),
  history: (id: string, offset = 0) => request<{ reports: RecoveryReport[] }>(`/${encodeURIComponent(id)}/recovery?offset=${offset}`),
  flag: (id: string, report: string) => request(`/${encodeURIComponent(id)}/recovery/${encodeURIComponent(report)}/flag`, {method: "POST"}),
  mine: () => request<{ tags: OwnerTag[] }>("/mine"),
  /** The signed-in owner's saved contact methods. */
  contacts: () => request<{ contacts: ContactMethods; settings?: TagSettings }>("/contacts"),
  /** Save contact methods (an empty value clears one) and, optionally, the name and language settings, in one request. */
  saveContacts: (input: Partial<ContactMethods>, settings?: Partial<TagSettings>) =>
    request<{ contacts: ContactMethods; settings?: TagSettings }>("/contacts", { method: "PUT", body: settings ? { ...input, settings } : input }),
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
/** A finder-facing link from the server: only https, tel and plain mailto addresses are ever rendered as links. */
export const safeLink = (url: string) => (/^(https:\/\/[^\s<>"']+|tel:\+?[0-9]{5,20}|mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24})$/.test(url) ? url : null);

const API_BASE = API_URL;
const qrCache = new Map<string, string>();
/** An object URL of the QR image of one of your own tags (fetched once per page visit, owner only). */
export async function ownerQrUrl(tagId: string): Promise<string> {
  const cached = qrCache.get(tagId);
  if (cached) return cached;
  const token = localStorage.getItem("ebalik_token");
  const response = await fetch(`${API_BASE}/api/tags/${encodeURIComponent(tagId)}/qr`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
  if (!response.ok) throw new TagRequestError("QR code unavailable", response.status);
  const url = URL.createObjectURL(await response.blob());
  qrCache.set(tagId, url);
  return url;
}
export const safeTel = (phone: string) => (/^\+?[0-9][0-9 ()\-]{5,18}[0-9]$/.test(phone) ? `tel:${phone.replace(/[^0-9+]/g, "")}` : null);
