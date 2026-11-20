import { json, response, type BoardReport } from './eventApi';

import type { PilotReport, PilotSnapshot } from "./pilotTypes";
export type { PilotReport, PilotSnapshot };
export interface HubListing extends BoardReport { publication_id: string; event_id: string; event_name: string; slug: string; published_at: string }
export interface IncomingTransfer { transfer_id: string; event_id: string; report_id: string; reference: string; event_name: string; receiver_name: string; destination: string; source_location: string; destination_storage: string | null; status: 'pending' | 'accepted'; version: number; accepted_at: string | null }
export const pilotSummary = (id: string, offset = 0, view = 'all', signal?: AbortSignal) => json<PilotSnapshot>(`/${encodeURIComponent(id)}/operations?offset=${offset}&view=${view}`, { signal });
export const hubListings = (offset = 0, kind = 'all', search = '', signal?: AbortSignal) => json<{ available: boolean; publications: HubListing[]; has_more: boolean }>(`/hub/publications?${new URLSearchParams({ offset: String(offset), kind, search })}`, { signal });
export const hubListing = (id: string, signal?: AbortSignal) => json<{ slug: string; listing: BoardReport; can_claim: boolean }>(`/hub/publications/${encodeURIComponent(id)}`, { signal });
export const recoveryInfo = (slug: string, signal?: AbortSignal) => json<{ available: boolean; instructions?: string; completed_at?: string | null }>(`/portal/${encodeURIComponent(slug)}/recovery-info`, { signal });
export const hubConsent = (event: string, report: string, signal?: AbortSignal) => json<{ allowed: boolean; version: number; reference: string }>(`/${encodeURIComponent(event)}/reports/${encodeURIComponent(report)}/hub-consent`, { signal });
export const setHubConsent = (event: string, report: string, version: number, allowed: boolean) => json<{ allowed: boolean; version: number; reference: string }>(`/${encodeURIComponent(event)}/reports/${encodeURIComponent(report)}/hub-consent`, { method: 'POST', body: JSON.stringify({ version, allowed }) });
export const incomingCustody = (offset = 0, signal?: AbortSignal) => json<{ available: boolean; transfers: IncomingTransfer[]; has_more: boolean }>(`/custody/incoming?offset=${offset}`, { signal });
export const acceptCustody = (transfer: IncomingTransfer, storage: string) => json<{ ok: boolean }>(`/${encodeURIComponent(transfer.event_id)}/custody/accept`, { method: 'POST', body: JSON.stringify({ transfer_id: transfer.transfer_id, version: transfer.version, storage, identity_checked: true }) });
export async function downloadPilotExport(id: string) {
  const result = await response(`/${encodeURIComponent(id)}/operations/export`);
  const url = URL.createObjectURL(await result.blob()); const link = document.createElement('a'); link.href = url; link.download = 'event-closing-register.zip'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
