import { useEffect, useState } from 'react';
import { AlertCircle, Bell, CheckCircle2, CircleX } from 'lucide-react';
import { motion, AnimatePresence } from "motion/react";
import { notificationsAPI } from '@/app/utils/api';
import { showInfoModal } from '@/app/shared/info-modal/infoModalStore';
import { CX, SPRING } from '@/app/utils/clay';
import { ReportListSkeleton } from '@/app/shared/LoadingSkeleton';

interface UserNotification {
  notification_id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  found_item_id?: string;
  missing_report_id?: string;
  notification_type?: string;
  link_label?: string;
  link_page?: string;
}

interface NotificationsPageProps {
  onNavigate?: (page: string, itemId?: string) => void;
}

export default function Notifications({ onNavigate }: NotificationsPageProps) {
  // All state & logic preserved exactly
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [markingAsRead, setMarkingAsRead] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadNotifications();
    const refreshWhenVisible = () => {
      if (!document.hidden) void loadNotifications(false);
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const refreshInterval = window.setInterval(refreshWhenVisible, 20000);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(refreshInterval);
    };
  }, []);

  const loadNotifications = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);
      const response = await notificationsAPI.getNotifications(100);
      if (response.error) { setError(response.error); setNotifications([]); }
      else                { setNotifications(response.data?.notifications || []); }
    } catch (err) {
      console.error('Failed to load notifications:', err);
      setError('Failed to load notifications. Please try again.');
      setNotifications([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      setMarkingAsRead(prev => new Set(prev).add(notificationId));
      const response = await notificationsAPI.markAsRead(notificationId);
      if (!response.error) {
        setNotifications(prev => prev.map(n => n.notification_id === notificationId ? { ...n, is_read: true } : n));
        window.dispatchEvent(new CustomEvent('ebalik-user-notifications-updated'));
      } else {
        showInfoModal({ variant: 'error', title: 'Notification not updated', message: response.error });
      }
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
      showInfoModal({ variant: 'error', title: 'Notification not updated', message: 'Could not mark this notification as read. Check your connection and try again.' });
    } finally {
      setMarkingAsRead(prev => { const next = new Set(prev); next.delete(notificationId); return next; });
    }
  };

  const handleNotificationClick = (notification: UserNotification) => {
    if (!notification.is_read) handleMarkAsRead(notification.notification_id);
    if (notification.link_page === 'claim' && notification.found_item_id && onNavigate) {
      onNavigate('claim', notification.found_item_id);
    } else if (notification.link_page === 'profile' && onNavigate) {
      onNavigate('profile');
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const isRejection = (n: UserNotification) =>
    n.notification_type?.endsWith('_rejection') ||
    n.title.toLowerCase().includes('not confirmed') ||
    n.title.toLowerCase().includes('rejected');

  // Loading screen
  if (loading) {
    return (
      <div className={CX.page}>
        <div className="mx-auto max-w-[720px] space-y-4">
          <div className={`${CX.card} space-y-3 p-5`}>
            <div className="h-6 w-44 animate-pulse rounded-lg bg-[#e8edf5]" />
            <div className="h-3 w-64 animate-pulse rounded-lg bg-[#eef2f7]" />
          </div>
          <ReportListSkeleton count={5} />
        </div>
      </div>
    );
  }

  return (
    <div className={CX.page}>
      <div className="mx-auto max-w-[720px]">

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <div className="flex items-center gap-2 mb-2">
            <Bell size={16} className="text-[#d1a153]" />
            <span className={CX.sectionLabel}>Account Updates</span>
          </div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-[32px] font-semibold text-navy-800" style={{ fontFamily: "var(--font-heading)" }}>
                Notifications
              </h1>
              <p className="mt-1 text-[14px] text-ink-muted">
                {unreadCount > 0
                  ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
                  : 'All caught up!'}
              </p>
            </div>
            {unreadCount > 0 && (
              <span className={`${CX.badgeNavy} text-[14px] px-5 py-2`}>{unreadCount}</span>
            )}
          </div>
        </motion.div>

        {/* Error banner */}
        {error && (
          <div className={`${CX.alertError} flex items-start gap-3 mb-6`}>
            <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-bold text-red-900 text-[13px]">Error loading notifications</p>
              <p className="mt-1 text-rose-800 text-[12px]">{error}</p>
              <button
                onClick={() => void loadNotifications()}
                className={`${CX.btnDanger} mt-3 px-4 py-2 text-[12px]`}
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {notifications.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
            className={`${CX.card} py-20 text-center flex flex-col items-center gap-4`}
          >
            <div className="flex size-[64px] items-center justify-center rounded-[20px] bg-emerald-50 border border-emerald-300/60">
              <CheckCircle2 className="text-emerald-500" size={32} />
            </div>
            <p className="text-[18px] font-bold text-navy-800">No notifications</p>
            <p className="text-[14px] text-ink-muted">You are all caught up.</p>
          </motion.div>
        ) : (
          <div className="flex flex-col gap-3">
            <AnimatePresence>
              {notifications.map((notification, index) => {
                const rejected = isRejection(notification);
                return (
                  <motion.div
                    key={notification.notification_id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ ...SPRING, delay: index * 0.04 }}
                    onClick={() => handleNotificationClick(notification)}
                    className={`${CX.cardSm} cursor-pointer p-4 transition-colors duration-200
                                ${!notification.is_read
                                  ? rejected
                                    ? 'border border-red-300/60 '
                                    : 'border border-gold-400/60 '
                                  : ''
                                }
                                 `}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon chip */}
                      <div className={`flex size-[38px] shrink-0 items-center justify-center rounded-[12px] border
                                      ${rejected
                                        ? 'bg-red-200 border-red-300/50 text-red-600'
                                        : 'bg-emerald-50 border-emerald-300/50 text-emerald-600'}
                                      `}>
                        {rejected ? <CircleX size={18} /> : <CheckCircle2 size={18} />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-[14px] font-bold text-navy-800">{notification.title}</h3>
                          {!notification.is_read && (
                            <span className="size-2.5 shrink-0 rounded-full bg-gold-500 mt-1.5" />
                          )}
                        </div>
                        <p className="mt-1 text-[13px] leading-[20px] text-ink-soft">{notification.message}</p>
                        <p className="mt-1.5 text-[12px] text-slate-500">
                          {new Date(notification.created_at).toLocaleString()}
                        </p>
                      </div>

                      {/* Mark as read */}
                      {!notification.is_read && (
                        <div className="shrink-0 self-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMarkAsRead(notification.notification_id); }}
                            disabled={markingAsRead.has(notification.notification_id)}
                            className={`${CX.btnGhost} px-3 py-1.5 text-[12px] font-bold disabled:opacity-50`}
                          >
                            {markingAsRead.has(notification.notification_id) ? 'Marking…' : 'Mark read'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Claim CTA */}
                    {notification.link_page === 'claim' && notification.found_item_id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleNotificationClick(notification); }}
                        className={`${CX.btnNavy} mt-3 px-4 py-2 text-[12px]`}
                      >
                        {notification.link_label || 'View Item'}
                      </button>
                    )}
                    {notification.link_page === 'profile' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleNotificationClick(notification); }}
                        className={`${CX.btnNavy} mt-3 px-4 py-2 text-[12px]`}
                      >
                        {notification.link_label || 'View Profile'}
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
