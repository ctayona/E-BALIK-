import type { NavigationOptions, Page } from '../types';

/** One notice as the API returns it (`/api/notifications`). */
export interface UserNotification {
  notification_id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  found_item_id?: string;
  /** The readable reference (FP2031) of the found item; `found_item_id` is the internal id and means nothing to a person. */
  found_item_reference?: string;
  missing_report_reference?: string;
  missing_report_id?: string;
  notification_type?: string;
  link_label?: string;
  link_page?: string;
}

/** Smart Tag notices created before the My Smart Tags page existed point at the dashboard, so they are matched by type too. */
export const opensSmartTags = (notification: UserNotification) =>
  notification.link_page === 'my-tags' || String(notification.notification_type || '').startsWith('smart_tag');

/** Where a notice leads, or null when it is information only. The full Notifications page and the header menu both use this. */
export function notificationTarget(notification: UserNotification): { page: Page; options?: NavigationOptions } | null {
  if (notification.link_page === 'claim' && notification.found_item_id) {
    // The claim form takes the readable reference. Without it (an older server) the form stays empty rather than showing an internal id.
    return { page: 'claim', options: { foundItemId: notification.found_item_reference || '' } };
  }
  if (notification.link_page === 'matches') return { page: 'matches', options: notification.missing_report_reference ? { reportId: notification.missing_report_reference } : undefined };
  if (notification.link_page === 'receipts') return { page: 'claim', options: { openReceipts: true } };
  if (notification.link_page === 'profile') return { page: 'profile' };
  if (notification.link_page === 'auction-hall') return { page: 'auction-hall' };
  if (notification.link_page === 'auction-selling') return { page: 'auction-hall', options: { auctionTab: 'selling' } };
  if (notification.link_page === 'my-reports') return { page: 'my-reports', options: { reportsTab: 'completed' } };
  if (opensSmartTags(notification)) return { page: 'my-tags' };
  return null;
}

export type NotificationKind = 'rejected' | 'claim' | 'auction' | 'match' | 'tag' | 'verification' | 'report' | 'announcement' | 'general';

/** The kind of a notice, used to pick its icon and colour. Falls back to the wording because older notices carry no type. */
export function notificationKind(notification: UserNotification): NotificationKind {
  const type = String(notification.notification_type || '').toLowerCase();
  const title = String(notification.title || '').toLowerCase();
  if (type.endsWith('_rejection') || title.includes('not confirmed') || title.includes('rejected')) return 'rejected';
  if (opensSmartTags(notification) || type.includes('tag')) return 'tag';
  if (type.includes('auction') || type.includes('seller') || title.includes('auction') || String(notification.link_page || '').startsWith('auction')) return 'auction';
  if (type.includes('claim') || notification.link_page === 'claim') return 'claim';
  if (type.includes('match') || title.includes('match')) return 'match';
  if (type.includes('verif') || notification.link_page === 'profile') return 'verification';
  if (type === 'announcement') return 'announcement';
  if (notification.link_page === 'my-reports' || type.includes('report') || type.includes('guard') || type.includes('release')) return 'report';
  return 'general';
}

/** "Just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function agoLabel(value?: string | null, now: number = Date.now()): string {
  const moment = value ? new Date(value).getTime() : NaN;
  if (Number.isNaN(moment)) return '';
  const seconds = Math.max(0, Math.floor((now - moment) / 1000));
  if (seconds < 45) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(moment).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

/** Tell the header badge and any open list that the unread count may have changed. */
export const announceNotificationsChanged = () => window.dispatchEvent(new CustomEvent('ebalik-user-notifications-updated'));
