import { API_URL, adminMutationRequest, getAuthHeaders } from "../../utils/api";

export interface EventBranding {
  template: "classic" | "festival" | "sports";
  primary: string;
  accent: string;
  background: string;
}
export interface EventInput {
  name: string;
  slug: string;
  organizer_name: string;
  venue: string;
  desk_instructions: string;
  starts_at: string | null;
  ends_at: string | null;
  recovery_ends_at: string | null;
  branding: EventBranding;
}
export type EventStatus = 'draft' | 'scheduled' | 'active' | 'recovery' | 'closed' | 'archived' | 'cancelled';
export interface EventDraft extends EventInput {
  event_id: string;
  version: number;
  status: EventStatus;
  portal_enabled?: boolean;
  deleted_at?: string | null;
  created_at: string;
}
export interface EventPerson { account_id: string; fname: string; lname: string; email: string; is_active: boolean }
export interface EventMember { membership_id: string; account_id: string; role: "manager" | "desk_staff"; status: "active" | "revoked"; expires_at: string; person: EventPerson | null }
export interface EventAsset { asset_id: string; kind: "logo" | "banner"; revision: number; url: string | null }
export type EventArtwork = Record<"logo" | "banner", EventAsset | null>;
export interface EventReview {
  event: EventDraft;
  ready: boolean;
  lifecycle_available: boolean;
  public_reporting_enabled: boolean;
  reports_available: boolean;
  portal_open: boolean;
  management_available: boolean;
  checks: { id: string; label: string; ok: boolean; step: 'details' | 'schedule' | 'team' }[];
  actions: EventStatus[];
  history: { history_id: string; from_status: EventStatus; to_status: EventStatus; note: string; created_at: string }[];
}
export class EventRequestError extends Error {
  constructor(message: string, public code: string) { super(message); }
}
export interface EventShareInfo {
  event: Pick<EventDraft, 'event_id' | 'slug' | 'name' | 'organizer_name' | 'venue' | 'desk_instructions' | 'recovery_ends_at' | 'branding' | 'status' | 'version'>;
  url: string; qr_image: string; portal_open: boolean; url_ready: boolean; share_ready: boolean; reason: string;
}
async function read<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new EventRequestError(typeof data.error === "string" ? data.error : "Unable to load event setup.", String(data.code || "request_failed"));
  return data as T;
}
const eventPath = (id: string) => `${API_URL}/api/admin/events/${encodeURIComponent(id)}`;
export const fetchEventShare = async (id: string, signal?: AbortSignal) => read<EventShareInfo>(await fetch(`${eventPath(id)}/share`, { headers: getAuthHeaders(), cache: 'no-store', signal }));
export const fetchEventReview = async (id: string) => read<EventReview>(await fetch(`${eventPath(id)}/review`, { headers: getAuthHeaders(), cache: 'no-store' }));
export const setEventPortal = async (event: EventDraft, enabled: boolean, note: string) => (await read<{ event: EventDraft }>(await adminMutationRequest(`${eventPath(event.event_id)}/portal`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ enabled, version: event.version, note }) }, enabled ? 'Open event portal' : 'Pause event portal'))).event;
export const transitionEvent = async (event: EventDraft, status: EventStatus, note: string) => (await read<{ event: EventDraft }>(await adminMutationRequest(`${eventPath(event.event_id)}/transition`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ status, version: event.version, note }) }, 'Change event state'))).event;
export const fetchEventMembers = async (id: string) => (await read<{ memberships: EventMember[] }>(await fetch(`${eventPath(id)}/memberships`, { headers: getAuthHeaders() }))).memberships;
export const findEventPerson = async (id: string, email: string) => (await read<{ person: EventPerson }>(await fetch(`${eventPath(id)}/staff-lookup?email=${encodeURIComponent(email.trim())}`, { headers: getAuthHeaders() }))).person;
export async function assignEventMember(id: string, account_id: string, role: EventMember['role'], expires_at: string) {
  return read(await adminMutationRequest(`${eventPath(id)}/memberships`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ account_id, role, expires_at }) }, 'Assign event staff'));
}
export async function revokeEventMember(id: string, member: string) {
  return read(await adminMutationRequest(`${eventPath(id)}/memberships/${encodeURIComponent(member)}/revoke`, { method: 'POST', headers: getAuthHeaders() }, 'Revoke event access'));
}
export const fetchEventArtwork = async (id: string) => (await read<{ assets: EventArtwork }>(await fetch(`${eventPath(id)}/assets`, { headers: getAuthHeaders() }))).assets;
export async function saveEventArtwork(id: string, kind: 'logo' | 'banner', revision: number, file: File | null) {
  const body = new FormData();
  body.set('revision', String(revision));
  if (file) body.set('file', file); else body.set('remove', 'true');
  const headers = getAuthHeaders(); delete headers['Content-Type'];
  return read(await adminMutationRequest(`${eventPath(id)}/assets/${kind}`, { method: 'POST', headers, body }, file ? 'Upload event artwork' : 'Remove event artwork'));
}
export async function fetchEventDrafts(offset = 0, view = 'all', signal?: AbortSignal): Promise<{ events: EventDraft[]; management_available: boolean }> {
  return read(await fetch(`${API_URL}/api/admin/events?offset=${offset}&view=${encodeURIComponent(view)}`, { headers: getAuthHeaders(), cache: 'no-store', signal }));
}
export const fetchEventDraft = async (id: string) => (await read<{ event: EventDraft }>(await fetch(eventPath(id), { headers: getAuthHeaders(), cache: 'no-store' }))).event;
export const manageEvent = async (event: EventDraft, action: 'archive' | 'delete' | 'restore', note: string) => (await read<{ event: EventDraft }>(await adminMutationRequest(`${eventPath(event.event_id)}/manage`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ action, version: event.version, note }) }, `${action} event workspace`))).event;
export async function fetchEventOptions(signal?: AbortSignal): Promise<string[]> {
  return (await read<{ venues: string[] }>(await fetch(`${API_URL}/api/admin/events/options`, { headers: getAuthHeaders(), cache: 'no-store', signal }))).venues;
}
export async function saveEventDraft(input: EventInput, current: EventDraft | null): Promise<EventDraft> {
  const body: Partial<EventInput> & { version?: number } = { ...input };
  // The server generates a stable identifier on create. Renaming an event preserves its link.
  delete body.slug;
  if (current) body.version = current.version;
  const path = current ? `/api/admin/events/${encodeURIComponent(current.event_id)}` : "/api/admin/events";
  const response = await adminMutationRequest(`${API_URL}${path}`, {
    method: current ? "PATCH" : "POST", headers: getAuthHeaders(),
    body: JSON.stringify(body),
  }, current ? "Save event draft" : "Create event draft");
  return (await read<{ event: EventDraft }>(response)).event;
}
