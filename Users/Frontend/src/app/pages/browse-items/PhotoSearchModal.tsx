import { useEffect, useRef, useState } from "react";
import { ArrowRight, ImageOff, ScanSearch } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import PhotoSourceButtons from "@/app/shared/PhotoSourceButtons";
import { CX } from "@/app/utils/clay";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const MAX_SIDE = 1024;

export type PhotoMatch = { reference: string; item_name: string; category?: string; location?: string; found_date?: string; image_url?: string; similarity: number };
type Outcome = { results: PhotoMatch[]; searched: number; waiting: number };

/** Phone photos are 5 to 12 MB. The server only needs the look of the picture, so shrink it first: faster, and always under the size limit. */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    return blob ? new File([blob], "search.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

async function search(file: File): Promise<Outcome> {
  const form = new FormData();
  form.append("image", file);
  const token = localStorage.getItem("ebalik_token");
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/found-items/photo-search`, { method: "POST", body: form, headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Photo search is unavailable right now.");
  return data as Outcome;
}

export default function PhotoSearchModal({ open, onClose, onClaim, onReportLost }: { open: boolean; onClose: () => void; onClaim: (reference: string) => void; onReportLost: () => void }) {
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const previewRef = useRef("");

  const reset = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreview(""); setOutcome(null); setError(""); setBusy(false);
  };
  useEffect(() => { if (!open) reset(); }, [open]);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const choose = async (picked: File) => {
    if (busy) return;
    if (!picked.type.startsWith("image/")) { setError("Choose a photo (JPG, PNG or WEBP)."); return; }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(picked);
    setPreview(previewRef.current); setOutcome(null); setError(""); setBusy(true);
    try { setOutcome(await search(await shrink(picked))); } catch (failure) { setError(failure instanceof Error ? failure.message : "Photo search is unavailable right now."); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      tone="iris"
      size="lg"
      icon={<ScanSearch size={22} />}
      title="Search by photo"
      description="Upload a picture of what you lost, or a similar one. We show items at the office that look alike."
      dismissible={!busy}
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {preview && <img src={preview} alt="The photo you are searching with" className="size-24 shrink-0 rounded-2xl border border-line object-cover shadow-card" />}
          <div className="min-w-0 flex-1">
            <PhotoSourceButtons onFile={(picked) => void choose(picked)} disabled={busy} />
            <p className="mt-2 text-[12.5px] leading-5 text-ink-muted">Best results: the item alone, in good light, from the front. Your photo is used for this search only and is not saved.</p>
          </div>
        </div>

        {busy && (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-frost-50 px-4 py-3.5" role="status" aria-live="polite">
            <span className="size-5 animate-spin rounded-full border-2 border-navy-200 border-t-navy-700" aria-hidden="true" />
            <p className="text-[14px] font-medium text-ink-soft">Comparing with items at the office...</p>
          </div>
        )}

        {error && <p role="alert" className={CX.alertError}>{error}</p>}

        {outcome && outcome.results.length > 0 && (
          <section aria-label="Items that look like your photo">
            <p className="mb-3 text-[13.5px] leading-5 text-ink-muted">{outcome.results.length} item{outcome.results.length === 1 ? "" : "s"} look similar, best match first. These are suggestions based on colour and shape: always check the details yourself.</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {outcome.results.map((match) => (
                <li key={match.reference} className={`${CX.card} flex min-w-0 flex-col overflow-hidden`}>
                  <div className="relative aspect-[4/3] bg-slate-100">
                    {match.image_url ? <img decoding="async" loading="lazy" src={match.image_url} alt={match.item_name} className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-slate-400"><ImageOff size={24} aria-hidden="true" /></span>}
                    <span className="absolute left-2 top-2 rounded-full bg-navy-900/85 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-white backdrop-blur" aria-label={`${match.similarity} percent similar`}>{match.similarity}% alike</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3.5">
                    <h3 className="truncate text-[14.5px] font-semibold text-navy-800">{match.item_name}</h3>
                    <p className="truncate text-[12.5px] text-ink-muted">{[match.category, match.location].filter(Boolean).join(" - ") || "Details at the office"}</p>
                    {match.found_date && <p className="text-[12.5px] text-ink-muted">Found {new Date(match.found_date).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" })}</p>}
                    <button type="button" onClick={() => { onClose(); onClaim(match.reference); }} className={`${CX.btnGold} mt-2 w-full !min-h-[40px] text-[13px]`}>This is mine, start a claim<ArrowRight size={15} aria-hidden="true" /></button>
                  </div>
                </li>
              ))}
            </ul>
            {outcome.waiting > 0 && <p className="mt-3 text-[12.5px] text-ink-muted">{outcome.waiting} newer item{outcome.waiting === 1 ? " is" : "s are"} still being prepared for photo search. Search again in a moment to include them.</p>}
          </section>
        )}

        {outcome && outcome.results.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line-strong bg-frost-50 px-6 py-8 text-center" role="status">
            <span className="mx-auto mb-2 flex size-11 items-center justify-center rounded-2xl bg-white text-navy-700 shadow-sm" aria-hidden="true"><ImageOff size={20} /></span>
            <p className="text-[16px] font-semibold text-ink" style={{ fontFamily: "var(--font-heading)" }}>Nothing looks like this yet</p>
            <p className="mx-auto mt-1 max-w-[44ch] text-[13.5px] leading-5 text-ink-muted">{outcome.searched === 0 ? "There are no items with photos at the office right now." : `We compared ${outcome.searched} item${outcome.searched === 1 ? "" : "s"}.`} File a lost report and we will email you the moment a matching item is handed in.</p>
            <button type="button" onClick={() => { onClose(); onReportLost(); }} className={`${CX.btnNavy} mt-4`}>Report my lost item<ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        )}
      </div>
    </Modal>
  );
}
