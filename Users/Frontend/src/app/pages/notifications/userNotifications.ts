export type UserNotification = {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  foundItemId?: string;
  missingReportId?: string;
  linkLabel?: string;
  page?: "claim";
};

const STORAGE_KEY = "ebalik_user_notifications";

export function getUserNotifications(): UserNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveUserNotifications(notifications: UserNotification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  window.dispatchEvent(new CustomEvent("ebalik-user-notifications-updated"));
}

export function getUnreadUserNotificationCount() {
  return getUserNotifications().filter((notification) => !notification.read).length;
}

export function markUserNotificationRead(id: string) {
  const notifications = getUserNotifications().map((notification) =>
    notification.id === id ? { ...notification, read: true } : notification,
  );
  saveUserNotifications(notifications);
}

export function pushUserNotification(payload: Omit<UserNotification, "id" | "read" | "createdAt"> & { id?: string }) {
  const notifications = getUserNotifications();
  const nextNotification: UserNotification = {
    id: payload.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: payload.title,
    message: payload.message,
    read: false,
    createdAt: new Date().toISOString(),
    foundItemId: payload.foundItemId,
    missingReportId: payload.missingReportId,
    linkLabel: payload.linkLabel ?? "Submit a claim",
    page: payload.page ?? "claim",
  };

  const updated = [nextNotification, ...notifications].slice(0, 20);
  saveUserNotifications(updated);
  return nextNotification;
}
