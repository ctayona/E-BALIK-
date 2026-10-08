import { useEffect, useState } from 'react';
import { authUtils } from './api';

/**
 * System-wide events and status.
 *
 * The API client raises `SYSTEM_EVENT` when the server says the app is in maintenance, the session was revoked
 * (force logout), the account is suspended, or a verified account is required. App.tsx listens and reacts once.
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const SYSTEM_EVENT = 'ebalik:system';
export type SystemCode = 'maintenance' | 'suspended' | 'session_revoked' | 'verification_required';
export interface SystemEventDetail { code: SystemCode; message?: string; until?: string | null }

export function emitSystemEvent(detail: SystemEventDetail) {
  window.dispatchEvent(new CustomEvent<SystemEventDetail>(SYSTEM_EVENT, { detail }));
}

export type AnnouncementTone = 'info' | 'success' | 'warning' | 'critical';
/** The campus-wide banner. `id` changes whenever an admin edits it, so a visitor who closed it sees the new one. */
export interface Announcement { id: string; tone: AnnouncementTone; title: string; message: string }
export interface SystemStatus { maintenance: boolean; message: string; since: string | null; announcement?: Announcement | null }
const OPEN: SystemStatus = { maintenance: false, message: '', since: null };

const TONES: AnnouncementTone[] = ['info', 'success', 'warning', 'critical'];

function readAnnouncement(value: unknown): Announcement | null {
  const note = value as Partial<Announcement> | null;
  if (!note || typeof note.message !== 'string' || !note.message.trim()) return null;
  return { id: String(note.id || note.message), tone: TONES.includes(note.tone as AnnouncementTone) ? (note.tone as AnnouncementTone) : 'info', title: String(note.title || ''), message: note.message };
}

/** The live announcement banner, polled every 30 seconds. Returns null while no announcement is on. */
export function useAnnouncement(): Announcement | null {
  const [note, setNote] = useState<Announcement | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${API_URL}/api/system/status`);
        if (!response.ok || !active) return;
        const next = readAnnouncement((await response.json()).announcement);
        setNote((current) => (current?.id === next?.id && current?.message === next?.message ? current : next));
      } catch { /* offline: keep what is shown */ }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return note;
}

export async function fetchSystemStatus(): Promise<SystemStatus | null> {
  try {
    const response = await fetch(`${API_URL}/api/system/status`);
    if (!response.ok) return null;
    const data = await response.json();
    return { maintenance: Boolean(data.maintenance), message: String(data.message || ''), since: data.since || null };
  } catch {
    return null;
  }
}

/** Live maintenance state: polled every 30 seconds and updated at once when any API call reports maintenance. */
export function useSystemStatus(): SystemStatus & { refresh: () => Promise<void> } {
  const [status, setStatus] = useState<SystemStatus>(OPEN);

  const refresh = async () => {
    const next = await fetchSystemStatus();
    if (next) setStatus((current) => (current.maintenance === next.maintenance && current.message === next.message ? current : next));
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<SystemEventDetail>).detail;
      if (detail?.code === 'maintenance') setStatus((current) => (current.maintenance ? current : { maintenance: true, message: detail.message || '', since: current.since }));
    };
    window.addEventListener(SYSTEM_EVENT, onEvent);
    return () => { window.clearInterval(timer); window.removeEventListener(SYSTEM_EVENT, onEvent); };
  }, []);

  return { ...status, refresh };
}

export const isStaff = (user?: { access_level?: string } | null) => ['admin', 'super_admin'].includes(String(user?.access_level || '').toLowerCase());

/** Administrators plus guards. A guard also uses the normal user pages (to file a found report, browse items), so they are never held back by
 *  maintenance mode or the ID-verification gate, exactly as the server treats them (`DESK_LEVELS` in system_control.py). */
export const isDesk = (user?: { access_level?: string } | null) => ['admin', 'super_admin', 'guard'].includes(String(user?.access_level || '').toLowerCase());

/** True once an admin has approved the account. Staff accounts and guards never need verification. */
export const isVerified = (user?: { verification_status?: string; access_level?: string } | null) =>
  isDesk(user) || String(user?.verification_status || '').toLowerCase() === 'verified';

/** The signed-in user, re-read whenever the profile is refreshed, so verification banners react as soon as an admin approves the account. */
export function useCurrentUser() {
  const [user, setUser] = useState(() => authUtils.getUserData());
  useEffect(() => {
    const sync = () => setUser(authUtils.getUserData());
    window.addEventListener('ebalik:user-updated', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('ebalik:user-updated', sync); window.removeEventListener('storage', sync); };
  }, []);
  return user;
}
