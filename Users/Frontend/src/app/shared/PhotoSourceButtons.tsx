import { useRef } from "react";
import { Camera, ImageIcon } from "lucide-react";
import { CX } from "@/app/utils/clay";

/**
 * Two clear ways to add a picture: take one with the camera, or upload one from the phone or computer.
 * On a phone "Take photo" opens the camera app straight away and "Upload photo" opens the gallery or files; on a computer both open
 * the file picker. `allowPdf` is for ID documents, which may be a PDF as well as a photo.
 */
export default function PhotoSourceButtons({ onFile, allowPdf = false, disabled = false, className = "" }: { onFile: (file: File) => void; allowPdf?: boolean; disabled?: boolean; className?: string }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";   // choosing the same file twice must still fire
    if (file) onFile(file);
  };
  return (
    <div className={`flex flex-col gap-2 sm:flex-row ${className}`}>
      <button type="button" disabled={disabled} onClick={() => cameraRef.current?.click()} className={`${CX.btnNavy} min-h-[44px] flex-1 justify-center`}>
        <Camera size={16} aria-hidden="true" /> Take photo
      </button>
      <button type="button" disabled={disabled} onClick={() => uploadRef.current?.click()} className={`${CX.btnGhost} min-h-[44px] flex-1 justify-center`}>
        <ImageIcon size={16} aria-hidden="true" /> {allowPdf ? "Upload photo or PDF" : "Upload photo"}
      </button>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} aria-label="Take a photo with the camera" tabIndex={-1} />
      <input ref={uploadRef} type="file" accept={allowPdf ? "image/*,application/pdf" : "image/*"} className="hidden" onChange={pick} aria-label="Upload a photo from your device" tabIndex={-1} />
    </div>
  );
}
