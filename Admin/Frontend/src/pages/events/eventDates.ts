/** Event controls use Manila UTC+8 regardless of the browser's timezone. */
export function manilaInput(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 16) : '';
}

export function manilaLabel(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }) + ' (Manila time)' : 'Invalid date';
}

export function staffExpiryProblem(value: string | null, deadline: string | null, now = Date.now()): string {
  const limit = deadline ? Date.parse(deadline) : NaN;
  if (Number.isFinite(limit) && limit <= now) return `The final claiming deadline (${manilaLabel(deadline!)}) has passed. Update the event Schedule before assigning staff.`;
  const end = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(end)) return 'Choose a valid date and time for staff access.';
  if (end <= now) return 'Staff access must end after the current time.';
  if (Number.isFinite(limit) && end > limit) return `Staff access cannot end after ${manilaLabel(deadline!)}. Choose an earlier time or extend the final claiming date in Schedule.`;
  return '';
}

export function customStaffExpiry(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const time = Date.parse(value + '+08:00');
  if (!Number.isFinite(time)) return null;
  const normalized = new Date(time + 8 * 3600000).toISOString().slice(0, value.length);
  return normalized === value ? new Date(time).toISOString() : null;
}
