/**
 * The date on a lost or found report: never in the future and not more than a year back, judged by the campus day (Manila, UTC+8).
 * Keep in step with Server/app/utils/report_dates.py, which checks every report again.
 */
const CAMPUS_OFFSET_MINUTES = 8 * 60;
const MAX_AGE_DAYS = 365;

/** Today's date on campus as YYYY-MM-DD (not the UTC day, and not the device's time zone). */
export function campusToday(now: Date = new Date()): string {
  return new Date(now.getTime() + CAMPUS_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** The oldest date a report may carry, as YYYY-MM-DD. */
export function earliestReportDate(now: Date = new Date()): string {
  const today = new Date(`${campusToday(now)}T00:00:00Z`);
  return new Date(today.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** "" when the date is fine, otherwise the sentence to show under the date field. */
export function reportDateProblem(value: string, label: string, now: Date = new Date()): string {
  const text = value.trim();
  if (!text) return `Enter the ${label}.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    return `The ${label} must be a real date.`;
  }
  if (text > campusToday(now)) return `The ${label} cannot be in the future. Choose today or an earlier day.`;
  if (text < earliestReportDate(now)) return `The ${label} cannot be more than a year ago. Check the year.`;
  return "";
}
