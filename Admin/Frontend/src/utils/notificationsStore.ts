export type AdminNotificationPriority = "High" | "Medium" | "Low";
export type AdminNotificationType = "claim" | "ai" | "item" | "system";

export interface AdminNotification {
  id: string;
  title: string;
  message: string;
  priority: AdminNotificationPriority;
  time: string;
  read: boolean;
  type: AdminNotificationType;
}

const NOTIFICATION_STORAGE_KEY = "ebalik_admin_notifications";

export function getStoredNotifications(): AdminNotification[] {
  try {
    const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AdminNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistNotifications(notifications: AdminNotification[]) {
  localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(notifications));
  window.dispatchEvent(new CustomEvent("ebalik-notifications-updated", {
    detail: { count: notifications.filter((notification) => !notification.read).length },
  }));
}

export function getUnreadNotificationCount(): number {
  return getStoredNotifications().filter((notification) => !notification.read).length;
}
