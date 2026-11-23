import { useEffect, useState } from "react";
import catalogue from "./campus.json";

export function useCampusVenues(fallback: string[] = catalogue.legacy) {
  const [venues, setVenues] = useState(fallback);
  useEffect(() => {
    const controller = new AbortController();
    const base = import.meta.env.VITE_API_URL || "http://localhost:5000";
    fetch(base + "/api/tags/venues", { signal: controller.signal })
      .then(async response => {
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.venues) && data.venues.every((v: unknown) => typeof v === "string")) setVenues(data.venues);
        }
      }).catch(() => {});
    return () => controller.abort();
  }, []);
  return venues;
}
