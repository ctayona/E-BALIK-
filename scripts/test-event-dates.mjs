import test from 'node:test';
import assert from 'node:assert/strict';
import { customStaffExpiry, manilaInput, manilaLabel, staffExpiryProblem } from '../Admin/Frontend/src/pages/events/eventDates.ts';

const now = Date.parse('2026-11-15T14:00:00Z');
const deadline = '2026-11-16T04:00:00Z';
test('custom staff times use Manila independently of machine timezone', () => {
  assert.equal(customStaffExpiry('2026-11-16T12:00'), new Date(deadline).toISOString());
  assert.equal(manilaInput(deadline), '2026-11-16T12:00');
});
test('accepts expiry at the claiming deadline and earlier future times', () => {
  assert.equal(staffExpiryProblem(deadline, deadline, now), '');
  assert.equal(staffExpiryProblem('2026-11-16T00:00:00Z', deadline, now), '');
});
test('out-of-range expiry explains the exact claiming limit', () => {
  const problem = staffExpiryProblem(customStaffExpiry('2026-11-20T12:00'), deadline, now);
  assert.match(problem, /cannot end after/);
  assert.ok(problem.includes(manilaLabel(deadline)));
  assert.match(problem, /Schedule/);
});
test('expired recovery window requires a schedule change', () => {
  assert.match(staffExpiryProblem(deadline, deadline, Date.parse(deadline)), /has passed/);
});
test('rejects empty, malformed and impossible dates without throwing', () => {
  for (const value of ['', 'not-a-date', '2026-02-30T12:00', '2026-13-01T09:00']) assert.equal(customStaffExpiry(value), null);
  assert.match(staffExpiryProblem(null, deadline, now), /valid date/);
});
test('seconds are parsed once without appending an extra time segment', () => {
  assert.equal(customStaffExpiry('2026-11-16T11:59:30'), '2026-11-16T03:59:30.000Z');
});
test('no event deadline still requires a future custom expiry', () => {
  assert.equal(staffExpiryProblem('2026-11-20T04:00:00Z', null, now), '');
  assert.match(staffExpiryProblem('2026-11-15T12:00:00Z', null, now), /after the current time/);
});
