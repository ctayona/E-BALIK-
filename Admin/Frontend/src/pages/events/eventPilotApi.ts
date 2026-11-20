import { API_URL, getAuthHeaders, adminMutationRequest } from '../../utils/api';
import { EventRequestError } from './eventsApi';
import type { PilotSnapshot, PilotReport } from '../../../../../Users/Frontend/src/app/pages/event-desk/pilotTypes';
export type { PilotSnapshot, PilotReport };
export interface HubPreview { listing: { report_id: string; reference: string; kind: string; public_label: string; category: string; venue: string; occurred_at: string }; event_name: string; report_version: number; consent_version: number; version: number; status: string; can_publish: boolean; hub_allowed: boolean }
const path = (id: string) => `${API_URL}/api/admin/events/${encodeURIComponent(id)}`;
async function read<T>(r: Response): Promise<T> { const data = await r.json().catch(() => ({})); if (!r.ok) throw new EventRequestError(data.error || 'Unable to process event operations.', data.code || 'request_failed'); return data; }
export const eventPilotSummary = async (id: string, offset: number, view: string, signal?: AbortSignal) => read<PilotSnapshot>(await fetch(`${path(id)}/operations?offset=${offset}&view=${view}`, { headers: getAuthHeaders(), cache: 'no-store', signal }));
export const eventHubPreview = async (id: string, report: string) => read<HubPreview>(await fetch(`${path(id)}/hub/${encodeURIComponent(report)}`, { headers: getAuthHeaders(), cache: 'no-store' }));
export const eventPilotCommand = async (id: string, action: string, data: Record<string, unknown>) => read(await adminMutationRequest(`${path(id)}/operations`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ action, data }) }, action.replaceAll('_', ' ')));
export const eventReceiverLookup = async (id: string, email: string) => read<{ person: { account_id: string; fname: string; lname: string } }>(await fetch(`${path(id)}/receiver-lookup?email=${encodeURIComponent(email.trim())}`, { headers: getAuthHeaders(), cache: 'no-store' }));
export async function downloadEventPilot(id: string) {
  const r = await fetch(`${path(id)}/operations/export`, { headers: getAuthHeaders(), cache: 'no-store' });
  if (!r.ok) { await read(r); return; }
  const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = 'event-closing-register.zip'; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
