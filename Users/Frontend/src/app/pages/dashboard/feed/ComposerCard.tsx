import { LibraryBig, PackagePlus, SearchX } from "lucide-react";
import type { NavigationOptions, Page } from "@/app/types";
import type { User } from "@/app/utils/useAuth";
import { FEED_CARD, GOLD_GRADIENT } from "./feedStyle";

export function initialsOf(user: Pick<User, "fname" | "lname"> | null | undefined) {
  return `${user?.fname?.[0] ?? ""}${user?.lname?.[0] ?? ""}`.toUpperCase() || "U";
}

const ACTIONS = [
  { label: "I found", sub: "Hand it in", icon: PackagePlus, chip: "bg-gold-50 text-gold-700 ring-gold-200/80", hover: "hover:bg-gold-50/80", text: "text-gold-800" },
  { label: "I lost", sub: "Start a search", icon: SearchX, chip: "bg-iris-50 text-iris-700 ring-iris-200/80", hover: "hover:bg-iris-50/80", text: "text-iris-700" },
  { label: "Browse all", sub: "See every item", icon: LibraryBig, chip: "bg-tide-50 text-tide-700 ring-tide-200/80", hover: "hover:bg-tide-50/80", text: "text-tide-700" },
] as const;

/**
 * "What did you find or lose?" The box opens the report chooser; the buttons go straight to the found form, the lost form or the item list.
 * Who may report is decided by the forms themselves (unverified accounts get the verification pop-up there).
 */
export default function ComposerCard({ user, onNavigate }: { user: User | null; onNavigate: (page: Page, options?: NavigationOptions) => void }) {
  const first = user?.fname?.split(" ")[0] || "there";
  const go = [
    () => onNavigate("found-item", { mode: "form" }),
    () => onNavigate("missing-item", { mode: "form" }),
    () => onNavigate("browse-items"),
  ];
  return (
    <section aria-label="Report an item" className={`${FEED_CARD} p-3.5 sm:p-4`}>
      <div className="flex items-center gap-3">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-navy-950 shadow-[0_6px_16px_-8px_rgba(209,161,83,0.9)] ring-2 ring-white ${GOLD_GRADIENT}`} aria-hidden="true">{initialsOf(user)}</span>
        <button
          type="button"
          onClick={() => onNavigate("report-item")}
          className="min-h-[48px] min-w-0 flex-1 truncate rounded-full border border-line bg-frost-50/80 px-4 text-left text-[15px] text-ink-muted transition-[border-color,background-color,box-shadow] duration-200 hover:border-iris-300 hover:bg-white hover:shadow-[0_0_0_4px_rgba(110,142,240,0.12)] focus-visible:border-iris-400"
        >
          What did you find or lose, {first}?
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-line/70 pt-3">
        {ACTIONS.map(({ label, sub, icon: Icon, chip, hover, text }, index) => (
          <button
            key={label}
            type="button"
            onClick={go[index]}
            className={`group flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 transition-[background-color,transform] duration-200 active:scale-[0.97] sm:flex-row sm:gap-2.5 sm:px-3 ${hover}`}
          >
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-200 group-hover:scale-110 ${chip}`} aria-hidden="true"><Icon size={17} /></span>
            <span className="min-w-0 text-center sm:text-left">
              <span className={`block text-[13.5px] font-semibold leading-4 sm:text-[14px] ${text}`}>{label}</span>
              <span className="hidden text-[11.5px] leading-4 text-ink-muted lg:block">{sub}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
