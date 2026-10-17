import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bell, BellOff, CheckCheck, ChevronRight, CircleX, ClipboardCheck, Gavel, Megaphone, PackageCheck, QrCode, ShieldCheck, Sparkles } from "lucide-react";
import type { NavigationOptions, Page } from "@/app/types";
import { notificationsAPI } from "@/app/utils/api";
import {
  agoLabel,
  announceNotificationsChanged,
  notificationKind,
  notificationTarget,
  type NotificationKind,
  type UserNotification,
} from "@/app/utils/notifications";

const KIND_LOOK: Record<NotificationKind, { icon: ReactNode; tone: string }> = {
  rejected: { icon: <CircleX size={19} />, tone: "bg-rose-50 text-rose-600 ring-rose-200/70" },
  claim: { icon: <ClipboardCheck size={19} />, tone: "bg-gold-100 text-gold-700 ring-gold-200/80" },
  auction: { icon: <Gavel size={19} />, tone: "bg-iris-100 text-iris-700 ring-iris-200/80" },
  match: { icon: <Sparkles size={19} />, tone: "bg-emerald-50 text-emerald-600 ring-emerald-200/70" },
  tag: { icon: <QrCode size={19} />, tone: "bg-frost-200 text-navy-700 ring-navy-200/60" },
  verification: { icon: <ShieldCheck size={19} />, tone: "bg-emerald-50 text-emerald-600 ring-emerald-200/70" },
  report: { icon: <PackageCheck size={19} />, tone: "bg-navy-50 text-navy-700 ring-navy-200/60" },
  announcement: { icon: <Megaphone size={19} />, tone: "bg-gold-100 text-gold-700 ring-gold-200/80" },
  general: { icon: <Bell size={19} />, tone: "bg-frost-200 text-navy-700 ring-navy-200/60" },
};

const LIST_SIZE = 20;

/**
 * The bell in the header. It opens a glass menu with the latest notifications instead of leaving the page: mark one or all as read,
 * jump to what a notice is about, or open the full Notifications page. Closes on an outside click, on Escape and when the page changes.
 * Phones get a menu that spans the screen below the header and stops above the bottom bar; larger screens get a popover under the bell.
 */
export default function NotificationMenu({
  currentPage,
  unreadCount,
  onNavigate,
}: {
  currentPage: Page;
  unreadCount: number;
  onNavigate: (page: Page, options?: NavigationOptions) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserNotification[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [markingAll, setMarkingAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const latestRequest = useRef(0);
  const reduced = useReducedMotion();
  const panelId = useId();
  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  const load = useCallback(async (quiet: boolean) => {
    const request = ++latestRequest.current;
    if (!quiet) setError("");
    const response = await notificationsAPI.getNotifications(LIST_SIZE).catch(() => ({ error: "Could not load your notifications.", data: undefined }));
    if (request !== latestRequest.current) return;
    if (response.error) {
      setError(quiet ? "" : response.error);
      if (!quiet) setItems(null);
    } else {
      setError("");
      setItems(((response.data as { notifications?: UserNotification[] } | undefined)?.notifications) ?? []);
    }
    setNow(Date.now());
  }, []);

  // Fetch when the menu opens, and quietly again whenever the unread count changes while it is open.
  useEffect(() => {
    if (open) void load(items !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unreadCount, load]);

  // Close on an outside press or Escape (Escape hands the focus back to the bell).
  useEffect(() => {
    if (!open) return;
    const onPress = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A page change (from the menu or anywhere else) closes the menu.
  useEffect(() => setOpen(false), [currentPage]);

  // Keyboard users land inside the menu when it opens.
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  const unreadInList = (items ?? []).filter((item) => !item.is_read).length;
  const shown = (items ?? []).filter((item) => filter === "all" || !item.is_read);

  async function markRead(notification: UserNotification) {
    setItems((current) => current && current.map((item) => (item.notification_id === notification.notification_id ? { ...item, is_read: true } : item)));
    const response = await notificationsAPI.markAsRead(notification.notification_id).catch(() => ({ error: "failed" }));
    if (response.error) {
      setItems((current) => current && current.map((item) => (item.notification_id === notification.notification_id ? { ...item, is_read: false } : item)));
      return;
    }
    announceNotificationsChanged();
  }

  function openNotification(notification: UserNotification) {
    if (!notification.is_read) void markRead(notification);
    const target = notificationTarget(notification);
    if (!target) return;
    setOpen(false);
    onNavigate(target.page, target.options);
  }

  async function markAll() {
    if (markingAll || (unreadInList === 0 && unreadCount === 0)) return;
    const before = items;
    setMarkingAll(true);
    setError("");
    setItems((current) => current && current.map((item) => ({ ...item, is_read: true })));
    const response = await notificationsAPI.markAllAsRead().catch(() => ({ error: "Could not reach the server." }));
    setMarkingAll(false);
    if (response.error) {
      setItems(before);
      setError("Could not mark your notifications as read. Try again.");
      return;
    }
    announceNotificationsChanged();
  }

  const spring = reduced ? { duration: 0 } : { type: "spring" as const, stiffness: 520, damping: 40 };

  return (
    <div ref={wrapRef} className="sm:relative">
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`group relative flex size-11 items-center justify-center rounded-xl transition-[background-color,transform] duration-200 active:scale-90 ${
          open || currentPage === "notifications" ? "bg-white/15 ring-1 ring-white/15" : "hover:bg-white/10"
        }`}
      >
        <Bell size={19} className="text-navy-100 transition-colors group-hover:text-gold-300" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-navy-800" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Notifications"
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={spring}
            style={{ transformOrigin: "top right" }}
            className="absolute inset-x-2 top-[calc(100%+8px)] z-50 flex max-h-[calc(100dvh-8.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/85 text-ink shadow-[0_26px_60px_-18px_rgba(18,31,66,0.6),inset_0_1px_0_rgba(255,255,255,0.7)] outline-none backdrop-blur-2xl backdrop-saturate-150 sm:inset-x-auto sm:right-0 sm:top-[calc(100%+10px)] sm:w-[410px] sm:max-h-[min(36rem,calc(100dvh-11rem))] lg:max-h-[min(36rem,calc(100dvh-6rem))]"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,transparent,#d1a153,transparent)]" aria-hidden="true" />

            <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-3.5">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="font-[family-name:var(--font-heading)] text-[19px] font-semibold tracking-[-0.01em] text-navy-800">Notifications</h2>
                {unreadCount > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11.5px] font-bold leading-4 text-white">{badge} new</span>}
              </div>
              <button
                type="button"
                onClick={() => void markAll()}
                disabled={markingAll || unreadCount === 0}
                className="-mr-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold text-iris-700 transition-[background-color,opacity] hover:bg-iris-50 disabled:cursor-default disabled:text-ink-muted disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <CheckCheck size={16} aria-hidden="true" /> Mark all as read
              </button>
            </div>

            <div className="flex shrink-0 gap-1.5 px-4 pb-2" role="group" aria-label="Show">
              {(["all", "unread"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`min-h-[44px] rounded-full px-4 sm:min-h-[36px] sm:px-3.5 text-[13px] font-semibold transition-colors ${
                    filter === value ? "bg-navy-800 text-white shadow-sm" : "bg-navy-50/80 text-navy-700 hover:bg-navy-100"
                  }`}
                >
                  {value === "all" ? "All" : "Unread"}
                </button>
              ))}
            </div>

            {error && items !== null && (
              <p role="alert" className="mx-3 mb-2 shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] leading-5 text-rose-800">{error}</p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth px-2 pb-2 [-webkit-overflow-scrolling:touch]">
              {items === null && !error ? (
                <ul aria-busy="true" aria-label="Loading notifications" className="space-y-1 py-1">
                  {[0, 1, 2, 3].map((row) => (
                    <li key={row} className="flex gap-3 rounded-xl px-2 py-3">
                      <span className="size-11 shrink-0 animate-pulse rounded-full bg-navy-100/70" />
                      <span className="flex-1 space-y-2 pt-1">
                        <span className="block h-3.5 w-3/5 animate-pulse rounded bg-navy-100/70" />
                        <span className="block h-3 w-full animate-pulse rounded bg-navy-50" />
                        <span className="block h-3 w-1/4 animate-pulse rounded bg-navy-50" />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : items === null ? (
                <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                  <p className="text-[14px] text-ink-muted">{error}</p>
                  <button type="button" onClick={() => void load(false)} className="min-h-[44px] rounded-xl bg-navy-800 px-5 text-[14px] font-semibold text-white hover:opacity-90">Try again</button>
                </div>
              ) : shown.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-frost-200 text-navy-600"><BellOff size={26} aria-hidden="true" /></span>
                  <p className="text-[15px] font-semibold text-navy-800">{filter === "unread" ? "No unread notifications" : "You're all caught up"}</p>
                  <p className="text-[13px] text-ink-muted">{filter === "unread" ? "Everything has been read." : "New updates about your reports, claims and auctions show up here."}</p>
                </div>
              ) : (
                <ul className="space-y-0.5 py-1">
                  {shown.map((notification) => {
                    const look = KIND_LOOK[notificationKind(notification)];
                    const unread = !notification.is_read;
                    return (
                      <li key={notification.notification_id}>
                        <button
                          type="button"
                          onClick={() => openNotification(notification)}
                          className={`group flex min-h-[64px] w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors active:bg-navy-100/70 ${unread ? "bg-iris-50/70 hover:bg-iris-100/70" : "hover:bg-navy-50/80"}`}
                        >
                          <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ring-1 ${look.tone}`} aria-hidden="true">{look.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className={`line-clamp-2 block text-[14px] leading-5 ${unread ? "font-semibold text-ink" : "font-medium text-ink-soft"}`}>{notification.title}</span>
                            {notification.message && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-[18px] text-ink-muted">{notification.message}</span>}
                            <span className={`mt-1 block text-[12px] leading-4 ${unread ? "font-semibold text-iris-700" : "text-ink-muted"}`}>{agoLabel(notification.created_at, now)}</span>
                          </span>
                          {unread ? <span className="mt-2 size-2.5 shrink-0 rounded-full bg-iris-500 shadow-[0_0_0_3px_rgba(110,142,240,0.22)]"><span className="sr-only">Unread</span></span> : (
                            notificationTarget(notification) && <ChevronRight size={16} className="mt-2 shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="shrink-0 border-t border-navy-100/60 p-2">
              <button
                type="button"
                onClick={() => { setOpen(false); onNavigate("notifications"); }}
                className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl text-[14px] font-semibold text-navy-800 transition-colors hover:bg-navy-50"
              >
                View full notifications <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
