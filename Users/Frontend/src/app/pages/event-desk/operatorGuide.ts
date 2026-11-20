import type { PilotSnapshot } from './pilotTypes';

// Shared content only: both frontends retain their own React runtime and modal primitives.
export const OPERATOR_SECTIONS = [
  { id: 'prepare', title: 'Before opening', steps: [
    ['Brief the team', 'Name the event manager and campus escalation contact. Confirm who holds the keys, where items are stored, and who receives them at closing. Record these on the printed desk pack.'],
    ['Check saved setup', 'In Admin Events, review the campus venue, desk instructions, Manila schedule and staff access expiry. Each staff member signs in with their own existing E-Balik account.'],
    ['Test the attendee journey', 'After authorized testing and migration verification, start the event in Review and explicitly open the attendee portal. Scan its event QR with a phone and check the correct event name and collection desk.'],
    ['Prepare a fallback', 'Download and print the desk pack before the shift. Keep completed paper sheets in secure staff custody. A downloaded pack is a saved snapshot, not evidence that the event is currently open.'],
  ] },
  { id: 'desk', title: 'During the event', steps: [
    ['Record and receive', 'Check Reports and intake for an existing record before adding one. A found report alone is not physical receipt: open the report, receive the actual item and record its storage location.'],
    ['Protect identifying details', 'Keep unique marks and ownership clues in the private description. Approve only a generic public label. Attendee board consent and separate hub permission are different decisions.'],
    ['Review possible matches', 'Use Possible matches to inspect the original reports. Managers can preview a generic event alert before sending it. A similarity score or alert is not ownership approval.'],
    ['Verify before release', 'Use Ownership claims for private evidence and manager review. Physically check the claimant and use the existing pickup-code release flow. Confirm the saved release receipt before treating the item as returned.'],
  ] },
  { id: 'close', title: 'Recovery and closing', steps: [
    ['Keep recovery available', 'After the event ends, the administrator begins Recovery in Review. Check the final claiming date and staff access. Owners follow existing claims; staff do not extend access by sharing accounts.'],
    ['Review unresolved records', 'Managers use Recovery summary. Super admins use Review → Operations for event-wide totals, the closing register and final attendee instructions. Office transfer is separate from owner recovery.'],
    ['Hand over remaining custody', 'After closing or cancellation, the super admin requests each handover to a different active office account. That named receiver opens /event-desk → Office handovers and acknowledges actual receipt and storage.'],
    ['Sign off and retain', 'After all physical receipts are acknowledged and open claims resolved, complete Closing plan and download the final register. Archive events with retained custody; do not delete their history.'],
  ] },
  { id: 'outage', title: 'If something fails', steps: [
    ['Keep physical custody safe', 'Use one numbered paper sheet per intake if the service is unavailable. Record only necessary item and custody facts. Do not write passwords, pickup codes, identity-document copies or private contact details on this sheet.'],
    ['Resolve uncertain saves', 'If a save times out, refresh and look for the existing report or receipt before retrying. Keep the original form open if possible. Never create repeated reports to work around an uncertain response.'],
    ['Pause risky actions', 'Do not approve claims or release items offline. For upload failures, access denial or incorrect event visibility, contact the named manager. The super admin can pause the attendee portal while investigating.'],
    ['Reconcile after recovery', 'An authorized staff member checks for duplicates, enters the report in the same event, records the paper reference and original receipt time in a private note, and records actual custody. Add the system reference to the sheet. Do not fabricate attendee consent or backdate a system receipt. If the event or assignment has ended, escalate to the super admin instead of bypassing the deadline.'],
  ] },
] as const;

export type OperatorSection = typeof OPERATOR_SECTIONS[number]['id'];
export type OperationsAction = { title: string; detail: string; target: 'custody' | 'closing' | null };

export function operationsNextAction(data: PilotSnapshot, now = Date.now()): OperationsAction {
  if (!data.available) return { title: 'Operations setup is unavailable', detail: 'Have the administrator verify the user-run pilot migration, then refresh.', target: null };
  if (data.event.deleted_at) return { title: 'Retained event history', detail: 'This workspace is deleted. Review retained records; operational changes are unavailable.', target: null };
  if (data.closure?.completed_at) return { title: 'Closing signed off', detail: 'Download and retain the final register. Outstanding owner follow-up continues through the university office.', target: null };
  const terminal = ['closed', 'cancelled', 'archived'].includes(data.event.status);
  if (!terminal) return { title: Date.parse(data.event.recovery_ends_at) <= now ? 'Review event closure' : 'Continue the event recovery workflow', detail: 'State changes are managed in Review. Complete recovery before closing; final office handovers become available after closure or cancellation.', target: null };
  if (data.claims.open > 0) return { title: `${data.claims.open} open claims need review`, detail: 'Closing remains blocked. Ask the administrator to investigate the claim states; do not bypass an ownership claim with a handover.', target: null };
  const unassigned = Math.max(0, data.counts.desk_custody - data.counts.pending_transfers);
  if (unassigned > 0) return { title: `${unassigned} custody ${unassigned === 1 ? 'item needs' : 'items need'} a handover`, detail: 'Select a different active office receiver for each item. Responsibility remains with the event desk until physical receipt is acknowledged.', target: 'custody' };
  if (data.counts.pending_transfers > 0) return { title: `${data.counts.pending_transfers} office receipts are pending`, detail: 'The named receivers must sign in to the event desk and acknowledge the actual items. Requesting a handover does not complete it.', target: 'custody' };
  return { title: 'Review the final closing plan', detail: 'Reconcile the unresolved register, save final follow-up instructions and acknowledge the closing checks. The server verifies eligibility again when saving.', target: 'closing' };
}

export interface DeskPackEvent { event_id: string; name: string; venue: string; desk_instructions: string; recovery_ends_at: string | null }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) + ' Manila' : 'Not scheduled';

export function deskPackHtml(event: DeskPackEvent): string {
  const safe = (value: string) => escapeHtml(value);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>E-Balik desk pack</title><style>
  *{box-sizing:border-box}body{margin:0;background:#eef1f7;color:#172540;font:13px/1.6 Arial,sans-serif}.page{max-width:900px;margin:24px auto;padding:40px;background:white}h1{font-size:26px;margin:8px 0;overflow-wrap:anywhere}h2{font-size:17px;border-bottom:2px solid #d1a153;padding-bottom:8px}h3{font-size:14px;margin-bottom:6px}p,li{overflow-wrap:anywhere}.eyebrow{letter-spacing:.15em;font-size:10px}.meta{padding:14px;border:1px solid #cad1df}.line{min-height:42px;border-bottom:1px solid #aab3c4;padding-top:12px}.space{height:95px;border:1px solid #aab3c4}.note{padding:12px;background:#f6f0e5}.print-help{max-width:900px;margin:20px auto;padding:0 16px}li{margin-bottom:8px}section{break-inside:avoid}@page{size:A4;margin:14mm}@media print{body{background:white;font-size:10pt}.page{margin:0;padding:0;max-width:none;break-after:page}.page:last-child{break-after:auto}.print-help{display:none}h1{font-size:20pt}.line{min-height:36px;margin:10px 0;padding-top:8px}}
  </style></head><body><p class="print-help">Saved desk pack. Use your browser's Print command to print or save as PDF. Print extra copies of the last page for intake. Check the live event before use.</p><main>
  <article class="page"><span class="eyebrow">E-BALIK / STAFF BRIEFING</span><h1>${safe(event.name)}</h1><div class="meta">Venue: ${safe(event.venue)}<br>Collection desk: ${safe(event.desk_instructions)}<br>Final claiming: ${safe(date(event.recovery_ends_at))}<br>Event reference: ${safe(event.event_id)}</div><p class="line">Shift / date: ____________________ Manager: ____________________</p><p class="line">Campus escalation contact / desk: ____________________________________</p><p class="line">Storage custodian / location: _________________________________________</p>${OPERATOR_SECTIONS.filter((s) => s.id === 'prepare' || s.id === 'desk').map((s) => `<section><h2>${safe(s.title)}</h2><ol>${s.steps.map(([title, body]) => `<li><strong>${safe(title)}.</strong> ${safe(body)}</li>`).join('')}</ol></section>`).join('')}</article>
  <article class="page"><span class="eyebrow">E-BALIK / RECOVERY & INCIDENT GUIDE</span><h1>${safe(event.name)}</h1>${OPERATOR_SECTIONS.filter((s) => s.id === 'close' || s.id === 'outage').map((s) => `<section><h2>${safe(s.title)}</h2><ol>${s.steps.map(([title, body]) => `<li><strong>${safe(title)}.</strong> ${safe(body)}</li>`).join('')}</ol></section>`).join('')}<p class="line">Issue observed / time / action taken: __________________________________</p><p class="line">Staff briefing completed by / date: ___________________________________</p><p class="note">Paper records are confidential. Store securely and reconcile with the original event. This pack does not approve claims, grant access or confirm system readiness.</p></article>
  <article class="page"><span class="eyebrow">E-BALIK / MANUAL INTAKE FALLBACK</span><h1>${safe(event.name)}</h1><p>Event reference: ${safe(event.event_id)}</p><p class="note">One sheet per item. No offline ownership approval or release. Do not record passwords, pickup codes, ID copies or personal contact details. This sheet is not a system report or release receipt.</p>${['Paper reference (unique within this event)', 'Recorded by / shift / Manila date and time', 'Report type: missing / found', 'Item category / generic description', 'Incident venue / original Manila date and time', 'Physical receipt: yes / no; original date and time', 'Actual storage location / staff custodian'].map((label) => `<p class="line">${label}: __________________________________</p>`).join('')}<h3>Private item / custody notes (necessary facts only)</h3><div class="space"></div><h2>Reconciliation after service recovery</h2>${['Duplicate checked by / date', 'Existing or new event report reference', 'Receipt and private paper-reference note verified by', 'Reconciliation completed by / date'].map((label) => `<p class="line">${label}: __________________________________</p>`).join('')}<p>Keep this sheet in staff custody under the university's record-retention procedure. Attendees use their own accounts for consent and ownership claims.</p></article></main></body></html>`;
}

export function downloadDeskPack(event: DeskPackEvent) {
  const url = URL.createObjectURL(new Blob([deskPackHtml(event)], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `ebalik-desk-pack-${event.event_id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 60)}.html`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
