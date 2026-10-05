import { useCallback, useEffect, useRef, useState } from "react";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { AuctionRequestError, auctionsApi } from "@/app/utils/auctions";

const LEGACY_KEY = "ebalik_auction_watchlist";

/**
 * Auctions the signed-in user has hearted. Saved on the server, so the choice follows the account across devices
 * and the admin can see who is interested. The heart answers instantly and is rolled back if saving fails.
 */
export function useWatchlist() {
  const [ids, setIds] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const busy = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    auctionsApi.watching().then(async (result) => {
      if (!active) return;
      let saved = result.ids;
      // Hearts saved on this device by the old version move to the account once, then the local copy is removed.
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
        if (Array.isArray(legacy) && legacy.length) {
          const missing = legacy.filter((id): id is string => typeof id === "string" && !saved.includes(id)).slice(0, 20);
          const moved = await Promise.allSettled(missing.map((id) => auctionsApi.react(id, true)));
          saved = [...saved, ...missing.filter((_, index) => moved[index].status === "fulfilled")];
        }
        localStorage.removeItem(LEGACY_KEY);
      } catch { /* storage unavailable: nothing to move */ }
      if (active) setIds(saved);
    }).catch(() => { /* the Auction Hall banner already explains a missing setup */ });
    return () => { active = false; };
  }, []);

  const toggle = useCallback(async (id: string) => {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    const turningOn = !ids.includes(id);
    setIds((current) => (turningOn ? [id, ...current] : current.filter((value) => value !== id)));
    try {
      const result = await auctionsApi.react(id, turningOn);
      setCounts((current) => ({ ...current, [id]: result.reaction_count }));
    } catch (reason) {
      setIds((current) => (turningOn ? current.filter((value) => value !== id) : [id, ...current]));
      showInfoModal({
        variant: "error",
        title: "Heart not saved",
        message: reason instanceof AuctionRequestError ? reason.message : "Your heart could not be saved. Check your connection and try again.",
      });
    } finally {
      busy.current.delete(id);
    }
  }, [ids]);

  return {
    watching: (id: string) => ids.includes(id),
    toggle,
    count: ids.length,
    /** Heart count for an auction: the latest number from the server after this user reacted, else the feed value. */
    countFor: (id: string, fallback: number) => counts[id] ?? fallback,
  };
}
