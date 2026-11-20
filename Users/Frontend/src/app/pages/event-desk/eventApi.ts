import { useEffect } from 'react';
import { authUtils } from '@/app/utils/api';
import { startSessionGuard, SESSION_NOTICE_KEY, type SessionEndReason } from '@/app/utils/sessionGuard';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:5000') + '/api/events';
export interface EventInfo { event_id: string; name: string; organizer_name: string; venue: string; desk_instructions: string; starts_at: string; ends_at: string; recovery_ends_at: string; status: string }
export interface PortalInfo { event: EventInfo & { slug: string; branding: { template: string; primary: string; accent: string; background: string } }; artwork: Record<'logo' | 'banner', { url: string | null } | null>; categories: string[]; venues: string[]; claims_available?: boolean }
export interface DeskInfo { event: EventInfo; role: string; expires_at: string; permissions: string[]; reports_available: boolean; claims_available?: boolean; operations_available?: boolean; reporting_enabled: boolean; portal_url: string; categories: string[]; venues: string[] }
export interface EventReport { report_id: string; event_id: string; reference: string; kind: 'missing' | 'found'; item_name: string; category: string; description: string; venue: string; location_details: string; occurred_at: string; moderation_status: 'pending' | 'approved' | 'hidden'; public_label: string | null; withdrawn_at: string | null; received_at: string | null; storage_location?: string | null; version: number; has_photo: boolean; released_at?: string | null; created_at: string }
export interface BoardReport { report_id: string; reference: string; kind: 'missing' | 'found'; category: string; public_label: string; venue: string; occurred_at: string; received_at: string | null }
export interface ReportDetail { report: EventReport; history: { history_id: string; action: string; note: string; created_at: string }[] }
export type ReportAction = 'approve' | 'hide' | 'receive' | 'note' | 'withdraw';
export interface ReportInput { board_consent: boolean; request_id: string; kind: 'missing' | 'found'; item_name: string; category: string; description: string; venue: string; location_details: string; occurred_at: string }
export class EventApiError extends Error { constructor(message: string, public code: string) { super(message); } }
export const manila = (value: string) => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
export const dateControl = (value: string) => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16);

function endSession(reason: SessionEndReason) {
  authUtils.clearAuthData(); localStorage.removeItem('ebalik_user_last_page'); sessionStorage.removeItem('ebalik_user_navigation_options');
  localStorage.setItem(SESSION_NOTICE_KEY, reason); window.location.replace('/');
}
export function useEventSession() {
  const token = authUtils.getToken();
  useEffect(() => token ? startSessionGuard({ tokenKey: 'ebalik_token', onEnd: endSession }) : undefined, [token]);
  return token;
}
export async function response(path: string, init: RequestInit = {}, privateRequest = true) {
  const headers = new Headers(init.headers);
  if (privateRequest) { const token = authUtils.getToken(); if (!token) throw new EventApiError('Sign in to your E-Balik account first.', 'sign_in_required'); headers.set('Authorization', `Bearer ${token}`); }
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  const result = await fetch(API + path, { ...init, headers, cache: 'no-store' });
  if (privateRequest && result.status === 401) endSession('expired');
  if (!result.ok) { const body = await result.json().catch(() => ({})); throw new EventApiError(typeof body.error === 'string' ? body.error : 'Unable to process this event request.', String(body.code || 'request_failed')); }
  return result;
}
export async function json<T>(path: string, init?: RequestInit, privateRequest = true): Promise<T> { return (await response(path, init, privateRequest)).json(); }
export const portalInfo = (slug: string, signal?: AbortSignal) => json<PortalInfo>(`/portal/${encodeURIComponent(slug)}`, { signal }, false);
export const portalBoard = (slug: string, offset: number, signal?: AbortSignal) => json<{ reports: BoardReport[] }>(`/portal/${encodeURIComponent(slug)}/reports?offset=${offset}`, { signal });
export const myEventReports = (slug: string, offset: number, signal?: AbortSignal) => json<{ reports: EventReport[] }>(`/portal/${encodeURIComponent(slug)}/mine?offset=${offset}`, { signal });
export const assignedEvents = (signal?: AbortSignal) => json<{ workspaces: DeskInfo[] }>('/mine', { signal });
export const eventQueue = (id: string, offset: number, signal?: AbortSignal) => json<{ reports: EventReport[] }>(`/${encodeURIComponent(id)}/reports?offset=${offset}`, { signal });
export const reportDetail = (event: string, report: string, signal?: AbortSignal) => json<ReportDetail>(`/${encodeURIComponent(event)}/reports/${encodeURIComponent(report)}`, { signal });
export async function submitReport(event: string, input: ReportInput, photo: File | null) { const body = new FormData(); body.set('payload', JSON.stringify(input)); if (photo) body.set('photo', photo); return json<{ report: EventReport }>(`/${encodeURIComponent(event)}/reports`, { method: 'POST', body }); }
export async function attendeeSubmit(slug: string, input: ReportInput, photo: File | null) { const body = new FormData(); body.set('payload', JSON.stringify(input)); if (photo) body.set('photo', photo); return json<{ report: EventReport }>(`/portal/${encodeURIComponent(slug)}/reports`, { method: 'POST', body }); }
export const reportAction = (event: string, report: EventReport, action: ReportAction, data: Record<string, string>) => json<{ report: EventReport }>(`/${encodeURIComponent(event)}/reports/${encodeURIComponent(report.report_id)}/actions`, { method: 'POST', body: JSON.stringify({ action, version: report.version, data }) });
export async function reportPhoto(event: string, report: string, signal?: AbortSignal) { return (await response(`/${encodeURIComponent(event)}/reports/${encodeURIComponent(report)}/photo`, { signal })).blob(); }
