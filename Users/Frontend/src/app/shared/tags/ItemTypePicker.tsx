import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { BatteryCharging, Backpack, Calculator, Check, ChevronDown, CupSoda, Glasses, Headphones, IdCard, KeyRound, Laptop, PenLine, Smartphone, Tablet, Umbrella, Wallet, Watch } from "lucide-react";
import { CX } from "@/app/utils/clay";

type Preset = { label: string; icon: ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }> };

/** The things people most often tag. The label is what is saved as the item name. */
export const ITEM_PRESETS: Preset[] = [
  { label: "Smartphone", icon: Smartphone },
  { label: "Laptop", icon: Laptop },
  { label: "Tablet", icon: Tablet },
  { label: "Keys", icon: KeyRound },
  { label: "Wallet", icon: Wallet },
  { label: "ID Card", icon: IdCard },
  { label: "Tumbler", icon: CupSoda },
  { label: "Backpack", icon: Backpack },
  { label: "Umbrella", icon: Umbrella },
  { label: "Earphones", icon: Headphones },
  { label: "Power bank", icon: BatteryCharging },
  { label: "Calculator", icon: Calculator },
  { label: "Watch", icon: Watch },
  { label: "Eyeglasses", icon: Glasses },
];

const OTHER = "__other__";
const options = [...ITEM_PRESETS.map((preset) => ({ key: preset.label, label: preset.label, icon: preset.icon })), { key: OTHER, label: "Other", icon: PenLine as Preset["icon"] }];

/**
 * A dropdown of common items with an "Other" choice that opens a text box. `value` is the item name that is saved:
 * a preset's label, or whatever the user typed. A saved name that is not a preset reopens as "Other" with the text filled in.
 * The list opens in the page flow (not as a floating layer), so it is never clipped inside a dialog.
 */
export default function ItemTypePicker({ value, onChange, label = "What is this tag attached to?", required = true }: { value: string; onChange: (name: string) => void; label?: string; required?: boolean }) {
  const preset = ITEM_PRESETS.find((item) => item.label.toLowerCase() === value.trim().toLowerCase());
  const [otherMode, setOtherMode] = useState(() => Boolean(value.trim()) && !preset);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const labelId = useId();
  const choice = otherMode ? OTHER : preset?.label ?? null;
  const chosen = options.find((option) => option.key === choice);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const openList = () => { setActive(Math.max(0, options.findIndex((option) => option.key === choice))); setOpen(true); };

  const pick = (key: string) => {
    setOpen(false);
    if (key === OTHER) {
      setOtherMode(true);
      if (preset) onChange("");
      window.setTimeout(() => customRef.current?.focus(), 30);
    } else {
      setOtherMode(false);
      onChange(key);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); openList(); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => (index + 1) % options.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index - 1 + options.length) % options.length); }
    else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(options.length - 1); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(options[active].key); }
    else if (event.key === "Tab") setOpen(false);
  };

  const Icon = chosen?.icon;

  return (
    <div ref={rootRef}>
      <span id={labelId} className={CX.label}>{label} {required && <span className="text-rose-600" aria-hidden="true">*</span>}</span>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        data-autofocus
        className={`${CX.input} flex w-full items-center gap-3 text-left ${open ? "border-iris-500 shadow-[0_0_0_4px_rgba(110,142,240,0.18)]" : ""}`}
      >
        {Icon ? <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><Icon size={17} aria-hidden="true" /></span> : <span className="size-8 shrink-0 rounded-lg border border-dashed border-line-strong" aria-hidden="true" />}
        <span className={`min-w-0 flex-1 truncate ${chosen ? "font-semibold text-ink" : "text-ink-muted"}`}>{chosen ? (choice === OTHER ? (value.trim() || "Other") : chosen.label) : "Choose an item"}</span>
        <ChevronDown size={18} className={`shrink-0 text-ink-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <ul id={listId} role="listbox" aria-labelledby={labelId} className="mt-2 grid max-h-[300px] grid-cols-1 gap-1 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-white/90 p-1.5 shadow-raised backdrop-blur-xl sm:grid-cols-2">
          {options.map((option, index) => {
            const OptionIcon = option.icon;
            const selected = option.key === choice;
            return (
              <li
                key={option.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option.key)}
                className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-2.5 text-[14.5px] transition-colors ${index === active ? "bg-gold-50 ring-1 ring-gold-300" : ""} ${selected ? "font-semibold text-ink" : "text-ink-soft"}`}
              >
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" : "bg-frost-100 text-navy-700"}`} aria-hidden="true"><OptionIcon size={16} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1 truncate">{option.label}{option.key === OTHER && <span className="ml-1.5 text-[12.5px] font-normal text-ink-muted">type your own</span>}</span>
                {selected && <Check size={16} className="shrink-0 text-gold-700" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}

      {otherMode && (
        <div className="mt-3">
          <label htmlFor={`${listId}-other`} className={CX.label}>Name your item <span className="text-rose-600" aria-hidden="true">*</span></label>
          <input id={`${listId}-other`} ref={customRef} value={value} onChange={(event) => onChange(event.target.value)} maxLength={120} placeholder="For example: Drawing tablet" autoComplete="off" className={`${CX.input} w-full`} />
        </div>
      )}
    </div>
  );
}
