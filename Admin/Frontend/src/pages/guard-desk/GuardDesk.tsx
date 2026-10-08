import { FilePlus2, LogOut, ShieldCheck } from "lucide-react";
import HandoverPinCard from "../dashboard/HandoverPinCard";
import AssignedItemsCard from "./AssignedItemsCard";
import GuardNoticesCard from "./GuardNoticesCard";
import AnnouncementBanner from "../../components/AnnouncementBanner";
import { BTN } from "../../components/ui/primitives";
import type { AdminUser } from "../../utils/api";
import { tr } from "../../utils/preferences";

/** A guard is also a normal user: the same sign-in opens the public app, where they can file a found report or browse items. */
function openUserPages() {
  const token = localStorage.getItem("ebalik_admin_token");
  const stored = localStorage.getItem("ebalik_admin_user");
  if (token && stored) {
    localStorage.setItem("ebalik_token", token);
    localStorage.setItem("ebalik_user", stored);
  }
  window.location.assign("/");
}

/**
 * The guard's front page: release an item by Handover PIN (typed or scanned). The admin console is closed to guards by the server, so
 * this is the only console screen; the button in the header opens the normal user pages (report a found item, browse) with the same sign-in.
 */
export default function GuardDesk({ user, onLogout }: { user: AdminUser; onLogout: () => void }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--surface-page,transparent)]">
      <AnnouncementBanner />
      <header className="border-b border-line bg-[var(--surface)] px-4 py-3 sm:px-8">
        <div className="mx-auto flex max-w-[860px] items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" aria-hidden="true"><ShieldCheck size={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="font-[family-name:var(--font-heading)] text-[17px] font-semibold leading-tight text-ink">{tr("Release desk")}</p>
            <p className="truncate text-[13px] text-ink-muted">{user.fname} {user.lname} · {tr("Guard")}</p>
          </div>
          <button type="button" onClick={openUserPages} className={BTN.gold}><FilePlus2 size={16} aria-hidden="true" /><span className="hidden sm:inline">{tr("Report or browse items")}</span><span className="sm:hidden">{tr("Report")}</span></button>
          <button type="button" onClick={onLogout} className={BTN.ghost}><LogOut size={16} aria-hidden="true" />{tr("Sign out")}</button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[860px] flex-1 space-y-5 p-4 sm:p-8">
        <GuardNoticesCard />
        <HandoverPinCard />
        <AssignedItemsCard />
        <section className="admin-card p-5 text-[14px] leading-6 text-ink-soft" aria-label={tr("How to release an item")}>
          <p className="font-semibold text-ink">{tr("Before you release an item")}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>{tr("Ask the owner for their Handover PIN, or scan the QR code on their phone.")}</li>
            <li>{tr("Check the name and campus ID on this screen against their ID card.")}</li>
            <li>{tr("Only then press Release. It cannot be undone.")}</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
