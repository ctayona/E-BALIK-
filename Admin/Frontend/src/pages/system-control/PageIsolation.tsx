import { useCallback, useEffect, useState } from "react";
import { LayoutDashboard, LockKeyhole, Monitor, Unlock } from "lucide-react";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, INPUT } from "../../components/ui/primitives";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { formatDateTime } from "../../utils/countdown";
import { fetchPageLocks, setPageLock, type PageLocks } from "../../utils/accessApi";
import { tr } from "../../utils/preferences";
import { Card, ErrorNote } from "./parts";

type Area = "user" | "admin";
const UNLOCKABLE_ADMIN = new Set(["system-control", "admin-profile", "dashboard"]);

/**
 * Page isolation: lock one page of the user site or the admin console while it is being fixed. Everyone except super
 * administrators sees a "temporarily locked" notice instead of the page, and the server refuses that page's API calls
 * (423 on the user site, 403 in the console). The public Smart Tag scan page always stays open for finders.
 */
export default function PageIsolation() {
  const [locks, setLocks] = useState<PageLocks | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [locking, setLocking] = useState<{ area: Area; page: string; label: string } | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setLocks(await fetchPageLocks()); } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to load the page locks.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const apply = async (area: Area, page: string, locked: boolean, note = "") => {
    setBusy(`${area}:${page}`);
    try {
      const result = await setPageLock(area, page, locked, note);
      setLocks((current) => current && { ...current, user: result.user, admin: result.admin });
      setLocking(null);
    } catch (failure) {
      showInfoModal({ variant: "error", title: tr("Page lock not changed"), message: failure instanceof Error ? failure.message : tr("Try again.") });
    } finally {
      setBusy("");
    }
  };

  const list = (area: Area) => {
    if (!locks) return null;
    const pages = area === "user" ? locks.user_pages : locks.admin_pages.filter((page) => !UNLOCKABLE_ADMIN.has(page.id));
    const current = locks[area];
    return (
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-[var(--surface)]">
        {pages.map((page) => {
          const lock = current[page.id];
          const key = `${area}:${page.id}`;
          return (
            <li key={page.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${lock ? "bg-gold-50/70 dark:bg-gold-500/[0.07]" : ""}`}>
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${lock ? "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" : "bg-frost-100 text-ink-muted"}`} aria-hidden="true">
                {lock ? <LockKeyhole size={16} /> : <Unlock size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold text-ink">{tr(page.label)}</p>
                <p className="truncate text-[12.5px] text-ink-muted">
                  {lock ? `${tr("Locked since {0}", { "0": formatDateTime(lock.since) })}${lock.message ? ` · ${lock.message}` : ""}` : tr("Open")}
                </p>
              </div>
              {lock
                ? <button type="button" onClick={() => void apply(area, page.id, false)} disabled={busy === key} className={`${BTN.ghost} !min-h-[38px]`}><Unlock size={15} aria-hidden="true" />{busy === key ? tr("Opening…") : tr("Unlock")}</button>
                : <button type="button" onClick={() => { setMessage(""); setLocking({ area, page: page.id, label: page.label }); }} className={`${BTN.ghost} !min-h-[38px]`}><LockKeyhole size={15} aria-hidden="true" />{tr("Lock")}</button>}
            </li>
          );
        })}
      </ul>
    );
  };

  const count = locks ? Object.keys(locks.user).length + Object.keys(locks.admin).length : 0;

  return (
    <Card icon={<LockKeyhole size={20} />} tone="gold" title={tr("Page isolation")}
      description={tr("Lock a page while you fix it. Everyone except super administrators sees a notice instead, and the server refuses that page's requests. Unlock it when the fix is live.")}
      aside={count > 0 ? <span className="rounded-full bg-gold-500 px-2.5 py-1 text-[12.5px] font-bold text-navy-950">{tr("{0} locked", { "0": count })}</span> : undefined}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!locks && !error && <SkeletonBlock className="h-64 w-full rounded-2xl" />}
      {locks && (
        <div className="grid gap-5 xl:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-ink"><Monitor size={16} className="text-gold-700 dark:text-gold-300" aria-hidden="true" />{tr("User site")}</h3>
            {list("user")}
            <p className="mt-2 text-[12.5px] leading-5 text-ink-muted">{tr("Locking Smart Tags keeps the public scan page open, so finders can still reach owners.")}</p>
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-ink"><LayoutDashboard size={16} className="text-gold-700 dark:text-gold-300" aria-hidden="true" />{tr("Admin console")}</h3>
            {list("admin")}
            <p className="mt-2 text-[12.5px] leading-5 text-ink-muted">{tr("The dashboard, My profile and System control cannot be locked: you need them to unlock the rest.")}</p>
          </div>
        </div>
      )}

      {locking && (
        <AdminModal title={tr("Lock {0}?", { "0": tr(locking.label) })} icon={<LockKeyhole size={19} />} tone="gold" size="sm" busy={Boolean(busy)} onClose={() => setLocking(null)}
          description={locking.area === "user" ? tr("Users see the notice below instead of this page until you unlock it.") : tr("Admins and guards see the notice below instead of this page until you unlock it.")}
          footer={<>
            <button type="button" onClick={() => setLocking(null)} disabled={Boolean(busy)} className={BTN.ghost}>{tr("Cancel")}</button>
            <button type="button" onClick={() => void apply(locking.area, locking.page, true, message)} disabled={Boolean(busy)} className={BTN.gold}><LockKeyhole size={16} aria-hidden="true" />{busy ? tr("Locking…") : tr("Lock page")}</button>
          </>}>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Notice shown to people (optional)")}</span>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={240} rows={3} className={`${INPUT} py-2.5`} placeholder={tr("We are fixing the claim form. It will be back this afternoon.")} data-autofocus />
            <span className="mt-1 block text-right text-[12px] text-ink-muted">{message.length}/240</span>
          </label>
        </AdminModal>
      )}
    </Card>
  );
}
