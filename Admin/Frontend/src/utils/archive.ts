import { API_URL, adminMutationRequest, getAuthHeaders } from "./api";

export type ArchiveKind = "lost" | "found" | "claim" | "auction";

/**
 * Archive a finished record, or bring it back. Archiving hides it from the page's working list (it moves to the Archived tab)
 * and deletes nothing. Only finished records qualify; the server refuses the rest with a plain message.
 */
export async function setArchived(kind: ArchiveKind, reference: string, archived: boolean): Promise<string> {
  const labels: Record<ArchiveKind, string> = { lost: "lost report", found: "found report", claim: "claim", auction: "auction" };
  const response = await adminMutationRequest(`${API_URL}/api/admin/archive`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ kind, reference, archived }),
  }, `${archived ? "Archive" : "Restore"} ${labels[kind]}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to update the archive");
  return typeof payload.message === "string" ? payload.message : "Done.";
}

/** The Archived tab shows archived records; every other tab hides them. */
export const ARCHIVED_TAB = "__archived__";
