import { useCallback, useEffect, useState } from "react";
import { API_URL, getAuthHeaders } from "../utils/api";
import { setArchived, type ArchiveKind } from "../utils/archive";
import { BTN } from "./ui/primitives";

export function useArchiveStatus(kind: "user" | "tag" | "found", enabled: boolean) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const reply = await fetch(API_URL + "/api/admin/archive/status/" + kind, { headers: getAuthHeaders() });
      if (!reply.ok) return;
      const body = await reply.json();
      setKeys(new Set(body.references));
    } catch { /* Existing list remains usable while the archive endpoint is unavailable. */ }
  }, [kind, enabled]);
  useEffect(() => {
    void reload();
    const update = () => void reload();
    window.addEventListener("ebalik-admin-archive-updated", update);
    return () => window.removeEventListener("ebalik-admin-archive-updated", update);
  }, [reload]);
  return keys;
}

export default function ArchiveRecord({ kind, reference, archived, onChanged }: {
  kind: ArchiveKind; reference: string; archived: boolean; onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await setArchived(kind, reference, !archived);
      window.dispatchEvent(new Event("ebalik-admin-archive-updated"));
      onChanged?.();
    } catch { /* The existing mutation helper displays the server explanation. */ }
    finally { setBusy(false); }
  }
  return <button type="button" className={BTN.ghost} disabled={busy} onClick={() => void save()}>
    {archived ? "Restore from archive" : "Archive"}
  </button>;
}
