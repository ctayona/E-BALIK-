import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CameraOff, QrCode, X } from "lucide-react";
import { BTN } from "../../components/ui/primitives";
import { tr } from "../../utils/preferences";

/** What the claimant's QR code contains: this prefix, then the 6 character PIN (see Server/app/utils/handover.py). */
const QR_PREFIX = "EBALIK-HANDOVER:";
const SCAN_EVERY_MS = 120;
const MAX_FRAME_SIDE = 720;

type Decode = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { data: string } | null;
let decoder: Promise<Decode> | null = null;
/** jsQR decodes in plain JavaScript (works in every browser) and is only downloaded the first time a guard opens the scanner. */
const loadDecoder = () => (decoder ??= import("jsqr").then((module) => module.default as unknown as Decode));

/** The PIN inside a scanned QR code, or "" when it is some other QR code. */
export function pinFromQr(text: string): string {
  const value = text.trim();
  if (!value.toUpperCase().startsWith(QR_PREFIX)) return "";
  const pin = value.slice(QR_PREFIX.length).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return pin.length === 6 ? pin : "";
}

function explain(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (typeof window !== "undefined" && window.isSecureContext === false) return tr("The camera only works on a secure (https) address. Type the PIN instead.");
  if (name === "NotAllowedError" || name === "SecurityError") return tr("Camera access is blocked. Allow the camera for this site in the browser settings, then try again.");
  if (name === "NotFoundError" || name === "OverconstrainedError") return tr("No camera was found on this device. Type the PIN instead.");
  if (name === "NotReadableError") return tr("The camera is being used by another app. Close it and try again.");
  return tr("The camera could not be started. Try again, or type the PIN.");
}

function ScanSheet({ onPin, onClose }: { onPin: (pin: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [ready, setReady] = useState(false);
  const done = useRef(false);

  const finish = useCallback((text: string): boolean => {
    const pin = pinFromQr(text);
    if (!pin) { setHint(tr("That is not an E-Balik Handover PIN code. Ask the owner to open their claim in E-Balik.")); return false; }
    if (done.current) return true;
    done.current = true;
    onPin(pin);
    return true;
  }, [onPin]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
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
  }, [finish]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={tr("Scan the owner's Handover PIN code")}>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className={`size-full object-cover transition-opacity duration-300 ${ready ? "opacity-100" : "opacity-0"}`} />
        {!error && (
          <div className="pointer-events-none absolute size-[min(72vw,320px)] rounded-3xl border-4 border-[#e6be76] shadow-[0_0_0_9999px_rgba(0,0,0,0.58)]" aria-hidden="true" />
        )}
        {!ready && !error && <p className="absolute text-[15px] font-medium text-[#ffffff]" role="status">{tr("Starting the camera…")}</p>}
        {error && (
          <div className="absolute inset-x-6 max-w-[440px] rounded-2xl border border-white/15 bg-white/10 p-5 text-center text-[#ffffff] backdrop-blur-xl sm:inset-x-auto" role="alert">
            <CameraOff size={26} className="mx-auto text-[#e9c47c]" aria-hidden="true" />
            <p className="mt-3 text-[15px] leading-6">{error}</p>
          </div>
        )}
        <button type="button" onClick={onClose} aria-label={tr("Close the scanner")} className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-full bg-white/15 text-[#ffffff] backdrop-blur hover:bg-white/25"><X size={20} aria-hidden="true" /></button>
      </div>
      <div className="bg-[#0b1430] px-6 py-4 text-center text-[#ffffff]" aria-live="polite">
        <p className="text-[15px] font-semibold">{tr("Point the camera at the QR code on the owner's phone")}</p>
        {hint && <p className="mt-1 text-[13.5px] text-[#fecdd3]">{hint}</p>}
      </div>
    </div>,
    document.body,
  );
}

export default function ScanPinButton({ onPin, disabled }: { onPin: (pin: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const picked = useCallback((pin: string) => { setOpen(false); onPin(pin); }, [onPin]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={`${BTN.ghost} min-h-[48px] w-full`}><QrCode size={18} aria-hidden="true" />{tr("Scan QR code")}</button>
      {open && <ScanSheet onPin={picked} onClose={close} />}
    </>
  );
}
