import test from 'node:test';
import assert from 'node:assert/strict';
import { deskPackHtml, operationsNextAction } from '../Users/Frontend/src/app/pages/event-desk/operatorGuide.ts';

const snapshot = (changes = {}) => ({ available: true, event: { status: 'closed', deleted_at: null, recovery_ends_at: '2026-11-18T04:00:00Z' }, claims: { open: 0 }, counts: { desk_custody: 0, pending_transfers: 0 }, closure: null, ...changes });
test('missing migration and deleted event never offer operational shortcuts', () => {
  assert.equal(operationsNextAction({ available: false }).target, null);
  assert.match(operationsNextAction(snapshot({ event: { deleted_at: '2026-11-18' } })).title, /Retained/);
});
test('signed-off history has no completion action', () => {
  const next = operationsNextAction(snapshot({ closure: { completed_at: '2026-11-18' } }));
  assert.equal(next.target, null); assert.match(next.title, /signed off/);
});
test('an expired active event still requires explicit lifecycle review', () => {
  const data = snapshot({ event: { status: 'active', recovery_ends_at: '2026-11-18T04:00:00Z' } });
  assert.match(operationsNextAction(data, Date.parse('2026-11-18T03:59:59Z')).title, /Continue/);
  const next = operationsNextAction(data, Date.parse('2026-11-18T04:00:00Z'));
  assert.match(next.title, /closure/); assert.equal(next.target, null);
});
test('open claims take priority over final custody handovers', () => {
  const next = operationsNextAction(snapshot({ claims: { open: 2 }, counts: { desk_custody: 3, pending_transfers: 1 } }));
  assert.match(next.title, /^2 open claims/); assert.equal(next.target, null);
});
test('pending receipts are not double-counted as unassigned custody', () => {
  const next = operationsNextAction(snapshot({ counts: { desk_custody: 3, pending_transfers: 2 } }));
  assert.match(next.title, /^1 custody item needs/); assert.equal(next.target, 'custody');
  assert.match(operationsNextAction(snapshot({ counts: { desk_custody: 2, pending_transfers: 2 } })).title, /^2 office receipts/);
});
test('only terminal events without claims or remaining custody point to sign-off', () => {
  for (const status of ['closed', 'cancelled', 'archived']) assert.equal(operationsNextAction(snapshot({ event: { status } })).target, 'closing');
  for (const status of ['draft', 'scheduled', 'active', 'recovery']) assert.equal(operationsNextAction(snapshot({ event: { status } })).target, null);
});
test('desk pack escapes metadata and never serializes report or account payloads', () => {
  const html = deskPackHtml({ event_id: 'event-123', name: '<script>alert(1)</script>', venue: 'A & B', desk_instructions: '"><img src=x onerror=alert(1)>', recovery_ends_at: '2026-11-18T04:00:00Z', reports: [{ description: 'PRIVATE_SENTINEL' }], token: 'SECRET_SENTINEL' });
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('PRIVATE_SENTINEL')); assert.ok(!html.includes('SECRET_SENTINEL'));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('A &amp; B'));
  assert.match(html, /default-src 'none'/); assert.match(html, /12:00/); assert.match(html, /Manila/);
  assert.equal((html.match(/<article class="page">/g) || []).length, 3);
});
test('unscheduled packs are explicit and preserve reconciliation safeguards', () => {
  const html = deskPackHtml({ event_id: 'event-123', name: 'Pilot', venue: 'Library', desk_instructions: 'Front desk', recovery_ends_at: null });
  assert.match(html, /Not scheduled/); assert.match(html, /No offline ownership approval or release/);
  assert.match(html, /Do not fabricate attendee consent/); assert.match(html, /Original|original/);
  assert.match(html, /Duplicate checked by/);
});
