import { useEffect, useState } from "react";
import { authUtils } from "@/app/utils/api";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * The claimant's Handover PIN as a QR code, so the guard can scan it instead of typing. The image comes from the server for the
 * signed-in owner only (never cached), is shown white-on-navy for contrast, and disappears quietly if it cannot be loaded:
 * the typed PIN above it always works.
 */
export default function HandoverQr({ claimId, path }: { claimId?: string; path?: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let active = true;
    let url = "";
    const token = authUtils.getToken();
    if (!token) return undefined;
    const route = path ?? (claimId ? `/api/claims/${encodeURIComponent(claimId)}/handover-qr` : "");
    if (!route) return undefined;
    fetch(`${API_URL}${route}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("no qr"))))
      .then((blob) => { if (active) { url = URL.createObjectURL(blob); setSrc(url); } })
      .catch(() => { if (active) setSrc(""); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [claimId, path]);

  if (!src) return null;
  return (
    <figure className="mt-3 flex flex-col items-center">
      <img src={src} alt="QR code of your Handover PIN. The guard scans it at the Lost and Found Office." width={168} height={168} className="size-[168px] rounded-xl bg-[#ffffff] p-1.5" />
      <figcaption className="mt-1.5 text-[11.5px] leading-4 text-[#b9c3dc]">Or let the guard scan this code</figcaption>
    </figure>
  );
}
