import { json, response } from './eventApi';

export interface EventClaim {
  claim_id: string; event_id: string; report_id: string; reference: string; status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'expired' | 'released';
  evidence: string; decision_note: string | null; pickup_expires_at: string | null; pin_issued_at: string | null; failed_attempts: number; released_at: string | null;
  version: number; created_at: string; has_proof: boolean; item_label: string; claimant_name?: string; pickup_code?: string | null; pickup_locked?: boolean;
}
export interface ClaimDetail { claim: EventClaim; history: { history_id: string; action: string; note: string; created_at: string }[] }
export interface EventReceipt { receipt_no: string; claim_id: string; event_id: string; event_name: string; item_label: string; released_to: string; released_at: string; verification_code: string }
const path = (event: string, claim?: string) => `/${encodeURIComponent(event)}/claims${claim ? '/' + encodeURIComponent(claim) : ''}`;
export async function createClaim(slug: string, input: { report_id: string; request_id: string; evidence: string }, proof: File | null) { const body = new FormData(); body.set('payload', JSON.stringify(input)); if (proof) body.set('proof', proof); return json<{ claim: EventClaim }>(`/portal/${encodeURIComponent(slug)}/claims`, { method: 'POST', body }); }
export const myClaims = (slug: string, offset = 0, signal?: AbortSignal) => json<{ claims: EventClaim[] }>(`/portal/${encodeURIComponent(slug)}/claims?offset=${offset}`, { signal });
export const staffClaims = (event: string, offset = 0, report?: string, signal?: AbortSignal) => json<{ claims: EventClaim[] }>(path(event) + `?offset=${offset}${report ? '&report_id=' + encodeURIComponent(report) : ''}`, { signal });
export const claimDetail = (event: string, claim: string, signal?: AbortSignal) => json<ClaimDetail>(path(event, claim), { signal });
export const claimAction = (claim: EventClaim, action: 'approve' | 'reject' | 'release' | 'withdraw' | 'reset_pin', data: Record<string, string | boolean>) => json<{ claim: EventClaim }>(path(claim.event_id, claim.claim_id) + '/actions', { method: 'POST', body: JSON.stringify({ action, version: claim.version, data }) });
export async function claimProof(claim: EventClaim, signal?: AbortSignal) { return (await response(path(claim.event_id, claim.claim_id) + '/proof', { signal })).blob(); }
export const claimReceipt = (event: string, claim: string, signal?: AbortSignal) => json<{ receipt: EventReceipt }>(path(event, claim) + '/receipt', { signal });
export const verifyEventReceipt = (claim: string, code: string, signal?: AbortSignal) => json<{ valid: boolean; item_label: string; released_on: string; receipt_no: string }>(`/receipts/${encodeURIComponent(claim)}/verify?code=${encodeURIComponent(code)}`, { signal }, false);
