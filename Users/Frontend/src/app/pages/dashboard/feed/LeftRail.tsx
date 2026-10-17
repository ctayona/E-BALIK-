import { Bell, Gavel, GitCompareArrows, LibraryBig, PackageSearch, QrCode, UserRound, FileStack, ClipboardCheck, ShieldCheck, type LucideIcon } from "lucide-react";
import type { Page } from "@/app/types";
import type { User } from "@/app/utils/useAuth";
import { initialsOf } from "./ComposerCard";
import { FEED_CARD, FEED_CARD_LIFT, GOLD_GRADIENT } from "./feedStyle";

const SHORTCUTS: Array<{ page: Page; label: string; icon: LucideIcon; tone: string }> = [
  { page: "browse-items", label: "Browse items", icon: LibraryBig, tone: "bg-iris-50 text-iris-700" },
  { page: "my-reports", label: "My reports", icon: FileStack, tone: "bg-gold-50 text-gold-700" },
  { page: "matches", label: "Matches", icon: GitCompareArrows, tone: "bg-tide-50 text-tide-700" },
  { page: "claim", label: "Claims", icon: ClipboardCheck, tone: "bg-iris-50 text-iris-700" },
  { page: "auction-hall", label: "Auction Hall", icon: Gavel, tone: "bg-gold-50 text-gold-700" },
  { page: "my-tags", label: "Smart Tags", icon: QrCode, tone: "bg-tide-50 text-tide-700" },
  { page: "notifications", label: "Notifications", icon: Bell, tone: "bg-iris-50 text-iris-700" },
];

/** Left column: who you are, and the campus shortcuts. Counts come from the page (your open lost reports). */
export default function LeftRail({ user, activeReports, onNavigate }: { user: User | null; activeReports: number; onNavigate: (page: Page) => void }) {
  const verified = String(user?.verification_status || "").toLowerCase() === "verified" || ["admin", "super_admin", "guard"].includes(String(user?.access_level || "").toLowerCase());
  const name = `${user?.fname ?? ""} ${user?.lname ?? ""}`.trim() || "Your account";
  return (
    <nav aria-label="Campus shortcuts" className="space-y-4">
      <button type="button" onClick={() => onNavigate("profile")} className={`group flex w-full items-center gap-3 ${FEED_CARD} ${FEED_CARD_LIFT} p-3.5 text-left`}>
        <span className={`flex size-12 shrink-0 items-center justify-center rounded-full ${GOLD_GRADIENT} text-[16px] font-bold text-navy-950 shadow-[0_6px_16px_-8px_rgba(209,161,83,0.9)] ring-2 ring-white`} aria-hidden="true">{initialsOf(user)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-semibold text-ink">{name}</span>
          <span className={`mt-0.5 inline-flex items-center gap-1 text-[12.5px] font-medium ${verified ? "text-tide-700" : "text-gold-700"}`}>
            {verified ? <ShieldCheck size={13} aria-hidden="true" /> : <UserRound size={13} aria-hidden="true" />}{verified ? "Verified" : "Not verified yet"}
          </span>
          {user?.campus_id && <span className="block truncate font-mono text-[11.5px] text-ink-muted">{user.campus_id}</span>}
        </span>
      </button>

      <div className={`${FEED_CARD} p-2`}>
        <p className="px-3 pb-1 pt-2 text-[12.5px] font-semibold text-ink-muted">Campus shortcuts</p>
        <ul>
          {SHORTCUTS.map(({ page, label, icon: Icon, tone }) => (
            <li key={page}>
              <button type="button" onClick={() => onNavigate(page)} className="flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 text-left text-[14.5px] font-medium text-ink-soft transition-colors hover:bg-frost-100 hover:text-ink">
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone}`} aria-hidden="true"><Icon size={17} /></span>
                <span className="flex-1">{label}</span>
                {page === "my-reports" && activeReports > 0 && <span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-gold-800">{activeReports}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <button type="button" onClick={() => onNavigate("report-item")} className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#2b4282_0%,#1f3160_100%)] px-4 text-[14.5px] font-semibold text-white shadow-card transition-opacity hover:opacity-95">
        <PackageSearch size={18} aria-hidden="true" />Report an item
      </button>
    </nav>
  );
}
