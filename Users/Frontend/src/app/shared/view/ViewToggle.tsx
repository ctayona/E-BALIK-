import { LayoutGrid, List } from "lucide-react";
import { useViewMode, type ViewMode } from "./useViewMode";

/** Segmented Tiles / List switch bound to the app-wide view preference. */
export default function ViewToggle({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const [mode, setMode] = useViewMode();
  const options: { value: ViewMode; label: string; Icon: typeof List }[] = [
    { value: "tile", label: "Tiles", Icon: LayoutGrid },
    { value: "list", label: "List", Icon: List },
  ];

  return (
    <div role="group" aria-label="Display items as" className={`inline-flex shrink-0 rounded-xl border border-line bg-white/85 p-1 shadow-card backdrop-blur ${className}`}>
      {options.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={compact ? `${label} view` : undefined}
            title={`${label} view`}
            onClick={() => setMode(value)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-[9px] text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-200 ${compact ? "w-9 justify-center" : "px-3"} ${
              active ? "bg-[linear-gradient(180deg,#2b4282_0%,#1f3160_100%)] text-white shadow-[0_6px_14px_-8px_rgba(17,27,66,0.8)]" : "text-ink-muted hover:bg-frost-100 hover:text-navy-800"
            }`}
          >
            <Icon size={16} aria-hidden="true" />
            {!compact && <span className="hidden sm:inline">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
