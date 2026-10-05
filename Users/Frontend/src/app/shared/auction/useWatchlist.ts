import { useCallback, useState } from "react";

const KEY = "ebalik_auction_watchlist";

function read(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, 200) : [];
  } catch {
    return [];
  }
}

/** Auctions the visitor has hearted. Stored on this device only. */
export function useWatchlist() {
  const [ids, setIds] = useState<string[]>(read);
  const toggle = useCallback((id: string) => {
    setIds((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [id, ...current].slice(0, 200);
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage can be blocked; the heart still toggles for this visit */ }
      return next;
    });
  }, []);
  return { watching: (id: string) => ids.includes(id), toggle, count: ids.length };
}
