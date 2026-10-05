import { useEffect, useState } from "react";
import { fetchAdminActivityLogs, fetchAdminClaims, reportAdminProcess, type UserActivityLog } from "../../utils/api";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import { getStoredNotifications, persistNotifications, type AdminNotification as Notification, type AdminNotificationPriority as NotificationPriority, type AdminNotificationType as NotificationType } from "../../utils/notificationsStore";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { T } from "../../components/ui/management";

import { tr } from "../../utils/preferences";
type Tab = "All" | "Unread" | "High Priority" | "Medium Priority" | "Low Priority";

const TABS: Tab[] = ["All", "Unread", "High Priority", "Medium Priority", "Low Priority"];

function getPriorityFromModule(module: string): NotificationPriority {
  const normalized = module.toLowerCase();
  if (normalized.includes("claim") || normalized.includes("user") || normalized.includes("ai")) return "High";
  if (normalized.includes("lost") || normalized.includes("found") || normalized.includes("custody")) return "Medium";
  return "Low";
}

function toRelativeTime(value?: string): string {
  if (!value) return tr("Just now");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tr("Just now");
  const diffMinutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 60) return tr("{0} minute{1} ago", { "0": diffMinutes, "1": diffMinutes === 1 ? "" : "s" });
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return tr("{0} hour{1} ago", { "0": diffHours, "1": diffHours === 1 ? "" : "s" });
  const diffDays = Math.round(diffHours / 24);
  return tr("{0} day{1} ago", { "0": diffDays, "1": diffDays === 1 ? "" : "s" });
}

function PriorityBadge({ priority }: { priority: NotificationPriority }) {
  const map = {
    High: { bg: "#fef2f2", text: "#dc2626", dot: "#ef4444" },
    Medium: { bg: "#fffbeb", text: "#d97706", dot: "#f59e0b" },
    Low: { bg: "#f0fdf4", text: "#166534", dot: "#22c55e" },
  } as const;
  const s = map[priority];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }}></span>
      {tr(priority)}
    </span>
  );
}

const typeIcon: Record<string, { bg: string; color: string; icon: React.ReactNode }> = {
  claim: { bg: "#eff6ff", color: "#2563eb", icon: <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" /></svg> },
  ai: { bg: "#f5f3ff", color: "#7c3aed", icon: <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="2" y="6" width="8" height="12" rx="2" stroke="currentColor" strokeWidth="2" /><rect x="14" y="6" width="8" height="12" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M10 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> },
  item: { bg: "#ecfdf5", color: "#059669", icon: <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m21 21-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> },
  system: { bg: "#fef2f2", color: "#dc2626", icon: <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> },
};

export default function Notifications() {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<{ type: "read" | "read-all" | "dismiss"; id?: string } | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([fetchAdminActivityLogs(), fetchAdminClaims()])
      .then(([logs, claims]) => {
        if (!active) return;

        const mapped: Notification[] = logs.map((log: UserActivityLog): Notification => ({
          id: log.id,
          title: log.action,
          message: tr("{0} {1} on {2}.", { "0": log.user, "1": log.action.toLowerCase(), "2": log.target }),
          priority: getPriorityFromModule(log.module),
          time: toRelativeTime(log.timestamp),
          read: false,
          type: (log.module.toLowerCase().includes("ai")
            ? "ai"
            : log.module.toLowerCase().includes("claim")
              ? "claim"
              : log.module.toLowerCase().includes("user")
                ? "system"
                : "item") as NotificationType,
        }));

        const claimAlerts = claims
          .filter((claim) => claim.status === "Under Review" || claim.status === "Pending")
          .slice(0, 3)
          .map((claim) => ({
            id: `claim-${claim.id}`,
            title: tr("Claim Requires Verification"),
            message: tr("{0} submitted a claim for {1}.", { "0": claim.claimant, "1": claim.item }),
            priority: "High" as const,
            time: toRelativeTime(claim.submitted),
            read: false,
            type: "claim" as const,
          }));

        const merged = [...mapped, ...claimAlerts].slice(0, 12);
        const stored = getStoredNotifications();
        const mergedWithReadState = merged.map((notification) => {
          const existing = stored.find((item) => item.id === notification.id);
          return existing ? { ...notification, read: existing.read } : notification;
        });
        const preserved = stored.filter((item) => !merged.some((notification) => notification.id === item.id));
        const finalNotifications = [...mergedWithReadState, ...preserved].slice(0, 12);

        setNotifs(finalNotifications);
        persistNotifications(finalNotifications);
      })
      .catch(() => {
        const stored = getStoredNotifications();
        setNotifs(stored);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const unreadCount = notifs.filter((n) => !n.read).length;

  const filtered = notifs.filter((n) => {
    if (activeTab === "All") return true;
    if (activeTab === "Unread") return !n.read;
    if (activeTab === "High Priority") return n.priority === "High";
    if (activeTab === "Medium Priority") return n.priority === "Medium";
    if (activeTab === "Low Priority") return n.priority === "Low";
    return true;
  });

  const markRead = (id: string) => {
    setNotifs((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      persistNotifications(updated);
      return updated;
    });
    reportAdminProcess({ success: true, title: "Notification updated", message: "The notification was marked as read." });
  };
  const markAllRead = () => {
    setNotifs((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      persistNotifications(updated);
      return updated;
    });
    reportAdminProcess({ success: true, title: "Notifications updated", message: "All notifications were marked as read." });
  };
  const dismiss = (id: string) => {
    setNotifs((prev) => {
      const updated = prev.filter((n) => n.id !== id);
      persistNotifications(updated);
      return updated;
    });
    reportAdminProcess({ success: true, title: "Notification dismissed", message: "The notification was removed from your list." });
  };

  const confirmPendingAction = () => {
    if (!pendingAction) return;
    if (pendingAction.type === "read" && pendingAction.id) markRead(pendingAction.id);
    else if (pendingAction.type === "read-all") markAllRead();
    else if (pendingAction.type === "dismiss" && pendingAction.id) dismiss(pendingAction.id);
    setPendingAction(null);
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]"><T k="page.notifications" /></h1>
          <p className="mt-1 max-w-[68ch] text-[14px] leading-6 text-ink-muted">{unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={() => setPendingAction({ type: "read-all" })} className="text-sm font-semibold hover:opacity-80 transition-opacity" style={{ color: "#2563eb" }}>
            {tr("Mark all as read")}
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-line shadow-card p-1.5 flex gap-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform]"
            style={activeTab === tab ? { background: "#1f3160", color: "white" } : { color: "#6b7280" }}
          >
            {tab === "Unread" ? tr("Unread ({0})", { "0": unreadCount }) : tr(tab)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4" aria-busy="true"><SkeletonBlock className="h-11 w-72 rounded-lg" /><AdminTableSkeleton columns={3} rows={6} /></div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-line shadow-card p-16 text-center text-slate-400">
              {tr("No notifications in this category")}
            </div>
          ) : (
            filtered.map((n) => {
              const ti = typeIcon[n.type];
              return (
                <div key={n.id} className="bg-white rounded-xl border shadow-sm p-5 transition-[color,background-color,border-color,box-shadow,opacity,transform]" style={{ borderColor: n.read ? "#f1f5f9" : "#e0f2fe" }}>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: ti.bg, color: ti.color }}>
                      {ti.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-slate-900">{n.title}</span>
                        <PriorityBadge priority={n.priority} />
                        {!n.read && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#3b82f6" }}></span>}
                        <span className="text-xs text-slate-400 ml-auto flex-shrink-0">{n.time}</span>
                      </div>
                      <p className="text-sm text-slate-600 mb-3">{n.message}</p>
                      <div className="flex items-center gap-4">
                        {!n.read && (
                          <button onClick={() => setPendingAction({ type: "read", id: n.id })} className="text-xs font-semibold hover:opacity-80" style={{ color: "#2563eb" }}>
                            {tr("Mark as read")}
                          </button>
                        )}
                        <button onClick={() => setPendingAction({ type: "dismiss", id: n.id })} className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors">
                          <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                          {tr("Dismiss")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
      {pendingAction && <ConfirmActionDialog
        title={pendingAction.type === "read-all" ? tr("mark all notifications as read") : pendingAction.type === "dismiss" ? tr("dismiss this notification") : tr("mark this notification as read")}
        description={tr("This updates your admin notification list.")}
        confirmLabel={pendingAction.type === "dismiss" ? tr("Dismiss") : tr("Confirm")}
        danger={pendingAction.type === "dismiss"}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />}
    </div>
  );
}
