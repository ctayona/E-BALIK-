import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, CameraOff, ScanLine, X } from "lucide-react";
import { CX } from "@/app/utils/clay";
import { extractTagCode } from "@/app/utils/tags";

/**
 * Reads a Smart Tag's QR code with the camera and hands back the tag code.
 *
 * It uses the jsQR library, which decodes frames in plain JavaScript, so it works in every browser with a camera
 * (desktop Chrome, Edge, Firefox, Safari, Android and iPhone), not only those with the BarcodeDetector API. The library
 * is loaded the first time someone opens the scanner, so it adds nothing to the rest of the app.
 * If the live camera cannot start (for example a phone opened over plain http), phones can still take a photo of the QR code.
 */

const SCAN_EVERY_MS = 120;
const MAX_FRAME_SIDE = 720;
const isTouch = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

type Decode = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { data: string } | null;
let decoder: Promise<Decode> | null = null;
const loadDecoder = () => (decoder ??= import("jsqr").then((module) => module.default as unknown as Decode));

/** Find a tag code in whatever the QR code contained (the scan URL, or the bare code on an RFID-style label). */
const tagCodeFrom = (text: string) => extractTagCode(text);

function explain(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (typeof window !== "undefined" && window.isSecureContext === false) return "Browsers only allow the camera on a secure (https) address. Open the https link of E-Balik, or type the code printed on the sticker.";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access is blocked. Allow the camera for this site in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device. Type the code printed on the sticker instead.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and try again.";
  return "The camera could not be started. Try again, or type the code printed on the sticker.";
}

function ScanSheet({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const photoId = useId();
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const done = useRef(false);
  const touch = isTouch();

  const finish = useCallback((text: string): boolean => {
    const code = tagCodeFrom(text);
    if (!code) { setHint("That QR code is not an E-Balik Smart Tag. Point the camera at the sticker."); return false; }
    if (done.current) return true;
    done.current = true;
    onCode(code);
    return true;
  }, [onCode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    setError("");
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) { setError(explain(null)); return undefined; }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (media) => {
        if (stopped) { media.getTracks().forEach((track) => track.stop()); return; }
        stream = media;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = media;
        await video.play().catch(() => undefined);
        const decode = await loadDecoder();
        if (stopped) return;
        setReady(true);
        timer = window.setInterval(() => {
          if (!context || !video.videoWidth || done.current) return;
          const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const found = decode(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
          if (found?.data && finish(found.data)) window.clearInterval(timer);
        }, SCAN_EVERY_MS);
      })
      .catch((failure) => { if (!stopped) setError(explain(failure)); });

    return () => { stopped = true; window.clearInterval(timer); stream?.getTracks().forEach((track) => track.stop()); };
  }, [finish, attempt]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  /** Phone fallback: the user photographs the QR code with the camera app and we read the picture. */
  const fromPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    try {
      const bitmap = await createImageBitmap(picked);
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("no canvas");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = (await loadDecoder())(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
      if (!found?.data) setHint("No QR code was found in that photo. Move closer, keep it steady and try again.");
      else finish(found.data);
    } catch {
      setHint("That photo could not be read. Try again.");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Scan the QR code on your sticker">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className={`size-full object-cover transition-opacity duration-300 ${ready ? "opacity-100" : "opacity-0"}`} />
        {!error && (
          <div className="pointer-events-none absolute size-[min(72vw,320px)] rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.58)]" aria-hidden="true">
            {["left-0 top-0 border-l-4 border-t-4 rounded-tl-3xl", "right-0 top-0 border-r-4 border-t-4 rounded-tr-3xl", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-3xl", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-3xl"].map((corner) => (
              <span key={corner} className={`absolute size-10 border-[#e6be76] ${corner}`} />
            ))}
            {ready && <span className="absolute inset-x-3 top-0 h-0.5 animate-[scanline_2.2s_ease-in-out_infinite] rounded-full bg-[#e6be76] shadow-[0_0_14px_3px_rgba(230,190,118,0.8)]" />}
          </div>
        )}
        {!ready && !error && <p className="absolute text-[15px] font-medium text-white/85" role="status">Starting the camera…</p>}
        {error && (
          <div className="absolute inset-x-6 max-w-[440px] rounded-2xl border border-white/15 bg-white/10 p-5 text-center text-white backdrop-blur-xl sm:inset-x-auto" role="alert">
            <CameraOff size={26} className="mx-auto text-[#e9c47c]" aria-hidden="true" />
            <p className="mt-2 text-[15px] leading-6">{error}</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" onClick={() => setAttempt((value) => value + 1)} className="min-h-[44px] rounded-xl border border-white/25 px-4 text-[14px] font-semibold hover:bg-white/10">Try again</button>
              {touch && <button type="button" onClick={() => photoRef.current?.click()} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#e6be76] px-4 text-[14px] font-semibold text-[#0e1830]"><Camera size={16} aria-hidden="true" />Take a photo of the QR code</button>}
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/75 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
          <p className="max-w-[72%] text-[14px] leading-5 drop-shadow">Hold the sticker inside the frame. The code is read automatically.</p>
          <button type="button" onClick={onClose} aria-label="Close the scanner" className="flex size-11 items-center justify-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25"><X size={20} aria-hidden="true" /></button>
        </div>
        {hint && <p className="absolute inset-x-6 bottom-[max(2rem,env(safe-area-inset-bottom))] rounded-xl bg-black/65 px-4 py-2.5 text-center text-[14px] font-medium text-white" role="status">{hint}</p>}
      </div>
      {touch && <input ref={photoRef} id={photoId} type="file" accept="image/*" capture="environment" onChange={(event) => void fromPhoto(event)} className="sr-only" tabIndex={-1} aria-hidden="true" />}
    </div>,
    document.body,
  );
}

/** "Scan QR code" button. `compact` shortens the label to "Scan" on phones so it fits beside a text field. */
export default function ScanCodeButton({ onCode, compact = false, className = "" }: { onCode: (code: string) => void; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const handle = useCallback((code: string) => { setOpen(false); onCode(code); }, [onCode]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Scan the QR code on the sticker with your camera"
        title="Scan the QR code with your camera"
        className={`${CX.btnGhost} min-h-[48px] shrink-0 gap-2 px-4 text-[14px] ${className}`}
      >
        <ScanLine size={18} aria-hidden="true" />
        {compact ? <><span className="sm:hidden">Scan</span><span className="hidden sm:inline">Scan QR code</span></> : <span>Scan QR code</span>}
      </button>
      {open && <ScanSheet onCode={handle} onClose={() => setOpen(false)} />}
    </>
  );
}
