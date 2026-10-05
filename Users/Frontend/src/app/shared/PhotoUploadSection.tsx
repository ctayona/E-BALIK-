import { useRef, useState } from "react";
import { Upload, Camera, ImageIcon } from "lucide-react";

export default function PhotoUploadSection({ label }: { label: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function handleFile(file: File) {
    setPreview(URL.createObjectURL(file));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-semibold text-ink text-[14px]">{label}</p>
      <div
        className="border-2 border-dashed border-gold-400 bg-[#fef8ec] rounded-[8px] flex flex-col items-center justify-center gap-2 py-8 cursor-pointer hover:bg-[#fdf3d9] dark:hover:bg-gold-500/20 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        {preview ? (
          <img decoding="async" src={preview} alt="Preview" className="max-h-[160px] max-w-full rounded object-contain" />
        ) : (
          <>
            <Upload size={28} className="text-[#d1a153]" />
            <p className="text-[13px] text-slate-500">Click to upload or drag image here</p>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex-1 bg-[#d1a153] text-navy-950 font-semibold text-[14px] h-[44px] rounded-[8px] flex items-center justify-center gap-2 hover:bg-[#b8893e] transition-colors"
        >
          <Camera size={16} /> Take Photo
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex-1 border border-gold-500 text-gold-800 font-semibold text-[14px] h-[44px] rounded-[8px] flex items-center justify-center gap-2 hover:bg-[#fef8ec] transition-colors"
        >
          <ImageIcon size={16} /> From Gallery
        </button>
      </div>
    </div>
  );
}
