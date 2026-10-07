/**
 * When is a report finished? The server marks an item's reports finished once the item is released to its owner (or sold and collected):
 * the lost report and the found report both end in `returned`. Keep these lists in step with Server/app/utils/report_lifecycle.py.
 */
export type ReportKind = "Missing" | "Found";

const COMPLETED: Record<ReportKind, readonly string[]> = {
  Missing: ["returned", "resolved", "closed"],
  Found: ["returned", "claimed", "closed", "collected"],
};

export function isCompletedReport(kind: ReportKind, status?: string | null): boolean {
  return COMPLETED[kind].includes(String(status || "").trim().toLowerCase());
}

/** The words a person sees: finished reports say "Completed", the rest keep their own status. */
export function reportStatusLabel(kind: ReportKind, status?: string | null): string {
  if (isCompletedReport(kind, status)) return "Completed";
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "Unknown";
  return value.replace(/_/g, " ");
}
