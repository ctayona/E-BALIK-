import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, CameraOff, RefreshCw, RotateCcw, ShieldCheck, X } from "lucide-react";
import { CX } from "@/app/utils/clay";

/**
 * A photo that can only come from the camera, live, at the moment of registration.
 *
 * - Browsers that allow it use getUserMedia: a live video feed with a shutter button. There is no gallery anywhere in that path.
 * - Phones whose browser blocks getUserMedia (for example a page opened without https) use a file input with
 *   `capture="environment"`, which opens the camera app directly. That fallback is offered only on touch devices, because on
 *   a desktop the `capture` hint is ignored and the file picker would open instead.
 * - Every picture is redrawn on a canvas, which also removes location data and shrinks it to a size the server accepts.
 */

const MAX_SIDE = 1280;
const JPEG_QUALITY = 0.85;
const MAX_RAW_BYTES = 25 * 1024 * 1024;

const hasLiveCamera = () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
const isTouchDevice = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

function explain(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access is blocked. Allow the camera for this site in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and try again.";
  return "The camera could not be started. Try again.";
}

/** Redraw an image source on a canvas: fixed JPEG, longest side 1280 px, no EXIF. */
async function toJpeg(source: CanvasImageSource, width: number, height: number): Promise<File> {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot process the photo.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("The photo could not be saved. Try again.");
  return new File([blob], `smart-tag-${Date.now()}.jpg`, { type: "image/jpeg" });
}

function CameraSheet({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [canFlip, setCanFlip] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const stop = useCallback(() => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError("");
    stop();
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false })
      .then(async (stream) => {
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => undefined); }
        try { setCanFlip((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput").length > 1); } catch { setCanFlip(false); }
      })
      .catch((failure) => { if (!cancelled) setError(explain(failure)); });
    return () => { cancelled = true; stop(); };
  }, [facing, attempt, stop]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const shoot = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy) return;
    setBusy(true);
    try {
      onCapture(await toJpeg(video, video.videoWidth, video.videoHeight));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The photo could not be saved. Try again.");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Take a photo of your item">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay onPlaying={() => setReady(true)} className={`size-full object-contain transition-opacity duration-300 ${ready ? "opacity-100" : "opacity-0"}`} />
        {!ready && !error && <p className="absolute text-[15px] font-medium text-white/80" role="status">Starting the camera…</p>}
        {error && (
          <div className="absolute inset-x-6 max-w-[420px] rounded-2xl border border-white/15 bg-white/10 p-5 text-center text-white backdrop-blur-xl sm:inset-x-auto" role="alert">
            <CameraOff size={26} className="mx-auto text-gold-300" aria-hidden="true" />
            <p className="mt-2 text-[15px] leading-6">{error}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/25 px-4 text-[14px] font-semibold hover:bg-white/10"><RefreshCw size={15} aria-hidden="true" />Try again</button>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
          <p className="max-w-[70%] text-[14px] leading-5 drop-shadow">Show your item with the Smart Tag sticker attached, then press the shutter.</p>
          <button type="button" onClick={onClose} aria-label="Close the camera" className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25"><X size={20} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="flex items-center justify-center gap-8 bg-black px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
        <span className="size-12" aria-hidden="true" />
        <button type="button" onClick={() => void shoot()} disabled={!ready || busy} aria-label="Take the photo" className="flex size-[76px] items-center justify-center rounded-full border-4 border-white/90 bg-transparent transition-transform active:scale-90 disabled:opacity-40">
          <span className="size-[58px] rounded-full bg-[#ffffff]" />
        </button>
        {canFlip
          ? <button type="button" onClick={() => setFacing((value) => (value === "environment" ? "user" : "environment"))} aria-label="Switch camera" className="flex size-12 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"><RotateCcw size={20} aria-hidden="true" /></button>
          : <span className="size-12" aria-hidden="true" />}
      </div>
    </div>,
    document.body,
  );
}

export default function LivePhotoField({ file, existingUrl, onChange, required = false, label = "Photo of the item with the sticker attached" }: {
  file: File | null;
  /** The photo already on the tag (edit mode), shown until a new one is taken. */
  existingUrl?: string | null;
  onChange: (file: File | null) => void;
  required?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const fallbackId = useId();
  const fallbackRef = useRef<HTMLInputElement>(null);
  const live = hasLiveCamera();
  const touch = isTouchDevice();
  const canUse = live || touch;

  useEffect(() => {
    if (!file) { setPreview(""); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const accept = (taken: File) => { setOpen(false); setError(""); onChange(taken); };

  const fromCameraApp = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    if (!picked.type.startsWith("image/") || picked.size > MAX_RAW_BYTES) { setError("Take a new photo with the camera."); return; }
    try {
      const bitmap = await createImageBitmap(picked);
      accept(await toJpeg(bitmap, bitmap.width, bitmap.height));
      bitmap.close();
    } catch {
      setError("That photo could not be read. Take it again.");
    }
  };

  const start = () => { setError(""); if (live) setOpen(true); else fallbackRef.current?.click(); };
  const shown = preview || existingUrl || "";

  return (
    <div>
      <p className={CX.label}>{label} {required && <span className="text-rose-600" aria-hidden="true">*</span>}</p>
      <div className={`mt-1.5 overflow-hidden rounded-2xl border ${shown ? "border-gold-300 bg-gold-50" : "border-dashed border-line-strong bg-frost-50"}`}>
        {shown ? (
          <div className="relative">
            <img src={shown} alt={file ? "The photo you just took" : "Current photo of the item"} className="max-h-[320px] w-full bg-navy-950 object-contain" />
            {file && <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-tide-600 px-2.5 py-1 text-[12px] font-semibold text-white shadow"><ShieldCheck size={13} aria-hidden="true" />Taken just now</span>}
          </div>
        ) : (
          <div className="px-5 py-7 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><Camera size={22} /></span>
            <p className="mt-3 text-[14.5px] font-semibold text-ink">Take a photo of your item with the sticker on it</p>
            <p className="mx-auto mt-1 max-w-[44ch] text-[13px] leading-5 text-ink-muted">It helps the finder and the Lost and Found Office know it is really yours. Photos from your gallery are not accepted: the picture must be taken now.</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line/70 bg-white/60 px-3 py-2.5">
          {canUse
            ? <button type="button" onClick={start} className={`${shown ? CX.btnGhost : CX.btnGold} min-h-[44px] px-4 text-[14px]`}><Camera size={16} aria-hidden="true" />{file ? "Retake photo" : existingUrl ? "Take a new photo" : "Open camera"}</button>
            : <p className="text-[13px] leading-5 text-rose-700" role="alert">This device has no usable camera here. Open this page on your phone to take the photo.</p>}
          {file && <button type="button" onClick={() => { onChange(null); setError(""); }} className="text-[13px] font-semibold text-ink-muted underline-offset-2 hover:underline">Remove</button>}
        </div>
      </div>
      {!live && touch && <input ref={fallbackRef} id={fallbackId} type="file" accept="image/*" capture="environment" onChange={(event) => void fromCameraApp(event)} className="sr-only" tabIndex={-1} aria-hidden="true" />}
      {error && <p role="alert" className="mt-2 text-[13px] text-rose-700">{error}</p>}
      {open && <CameraSheet onCapture={accept} onClose={() => setOpen(false)} />}
    </div>
  );
}
