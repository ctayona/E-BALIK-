/** "just now", "5m", "3h", "2d", then a short date. Used on posts, comments and stories. */
export function timeAgo(value?: string | null, now: number = Date.now()): string {
  const moment = value ? new Date(value).getTime() : NaN;
  if (Number.isNaN(moment)) return "";
  const seconds = Math.max(0, Math.floor((now - moment) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(moment).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

/** A readable absolute time for the tooltip of a relative time. */
export function fullTime(value?: string | null): string {
  const moment = value ? new Date(value) : null;
  return moment && !Number.isNaN(moment.getTime()) ? moment.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "";
}
