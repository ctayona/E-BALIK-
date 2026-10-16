import { LibraryBig, PackagePlus, SearchX } from "lucide-react";
import type { NavigationOptions, Page } from "@/app/types";
import type { User } from "@/app/utils/useAuth";

export function initialsOf(user: Pick<User, "fname" | "lname"> | null | undefined) {
  return `${user?.fname?.[0] ?? ""}${user?.lname?.[0] ?? ""}`.toUpperCase() || "U";
}

/**
 * "What did you find or lose?" The box opens the report chooser; the two buttons go straight to the found or lost form.
 * Who may report is decided by the forms themselves (unverified accounts get the verification pop-up there).
 */
export default function ComposerCard({ user, onNavigate }: { user: User | null; onNavigate: (page: Page, options?: NavigationOptions) => void }) {
  const first = user?.fname?.split(" ")[0] || "there";
  return (
    <section aria-label="Report an item" className="rounded-[20px] border border-white/80 bg-white/90 p-3.5 shadow-card sm:p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#e6be76] to-[#d1a153] text-[15px] font-bold text-navy-950" aria-hidden="true">{initialsOf(user)}</span>
        <button
          type="button"
          onClick={() => onNavigate("report-item")}
          className="min-h-[46px] flex-1 rounded-full border border-line bg-frost-50 px-4 text-left text-[15px] text-ink-muted transition-colors hover:border-iris-300 hover:bg-frost-100"
        >
          What did you find or lose, {first}?
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
        <button type="button" onClick={() => onNavigate("found-item", { mode: "form" })} className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold text-gold-800 transition-colors hover:bg-gold-50 sm:text-[14px]">
          <PackagePlus size={18} aria-hidden="true" />I found
        </button>
        <button type="button" onClick={() => onNavigate("missing-item", { mode: "form" })} className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold text-iris-700 transition-colors hover:bg-iris-50 sm:text-[14px]">
          <SearchX size={18} aria-hidden="true" />I lost
        </button>
        <button type="button" onClick={() => onNavigate("browse-items")} className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold text-tide-700 transition-colors hover:bg-tide-50 sm:text-[14px]">
          <LibraryBig size={18} aria-hidden="true" />Browse all
        </button>
      </div>
    </section>
  );
}
