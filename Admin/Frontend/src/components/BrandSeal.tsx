import { useState } from "react";
import sealUrl from "../imports/umak-seal.webp?inline";
import { tr } from "../utils/preferences";

/** The University of Makati seal. Embedded in the app (no separate file to go missing or be cached stale), and if it ever fails to decode a gold "UM" monogram shows instead of broken-image text. */
export const SEAL_URL = sealUrl;

export default function BrandSeal({ className = "size-10" }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={`${className} flex items-center justify-center rounded-full bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-[13px] font-bold text-navy-950`} aria-label={tr("University of Makati")}>UM</span>;
  }
  return <img src={sealUrl} alt={tr("University of Makati logo")} width={40} height={40} decoding="async" onError={() => setFailed(true)} className={`${className} rounded-full object-contain`} />;
}
