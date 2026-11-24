import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, MapPin, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { authUtils } from '@/app/utils/api';
import { startSessionGuard, SESSION_NOTICE_KEY, type SessionEndReason } from '@/app/utils/sessionGuard';
import EventDeskWorkspace from './EventDeskWorkspace';
import EventTagItems from './EventTagItems';
import EventCustodyInbox from './EventCustodyInbox';
import type { DeskInfo } from './eventApi';

type Desk = DeskInfo;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const date = (value: string) => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
const endSession = (reason: SessionEndReason) => {
  authUtils.clearAuthData();
  localStorage.removeItem('ebalik_user_last_page');
  sessionStorage.removeItem('ebalik_user_navigation_options');
  localStorage.setItem(SESSION_NOTICE_KEY, reason);
  window.location.replace('/');
};

export default function EventDesk() {
  const [workspaces, setWorkspaces] = useState<Desk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Desk | null>(null);
  const token = authUtils.getToken();
  useEffect(() => token ? startSessionGuard({ tokenKey: 'ebalik_token', onEnd: endSession }) : undefined, [token]);
  useEffect(() => {
    if (!token) { setWorkspaces([]); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setWorkspaces([]);
    fetch(`${API_URL}/api/events/mine`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (response.status === 401) { endSession('expired'); return; }
      if (!response.ok) throw new Error(body.error || 'Unable to verify your assignment.');
      if (!controller.signal.aborted) { const next: Desk[] = body.workspaces || []; setWorkspaces(next); setSelected((old) => old ? next.find((desk) => desk.event.event_id === old.event.event_id) || null : null); }
    }).catch((e) => { if (!controller.signal.aborted) { setSelected(null); setError(e instanceof Error ? e.message : 'Unable to load workspaces.'); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    // Revalidate access periodically and when returning to this tab; stale staff data is cleared while checking.
    const refresh = () => { if (!document.hidden) setRevision((value) => value + 1); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [token, revision]);
  const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-navy-800 shadow-sm hover:bg-navy-50 disabled:opacity-50';
  return <main className="min-h-screen bg-frost-100 px-4 py-6 text-ink sm:px-8 sm:py-10"><div className="mx-auto max-w-5xl">
    <header className="mb-7 flex flex-wrap items-center justify-between gap-3"><a href="/" className={button}><ArrowLeft size={16} />Back to E-Balik</a><button type="button" className={button} disabled={loading || !token} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={16} />Refresh access</button></header>
    {!selected && <section className="relative mb-6 overflow-hidden rounded-3xl border border-white/20 bg-navy-900 p-7 text-white shadow-raised sm:p-10"><div className="pointer-events-none absolute -right-10 -top-16 size-64 rounded-full bg-gold-500/15 blur-3xl" /><div className="relative"><span className="mb-5 inline-flex items-center gap-2 rounded-full border border-gold-300/30 bg-gold-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-gold-300"><ShieldCheck size={14} />Assigned staff only</span><h1 className="mb-3 text-3xl font-semibold tracking-tight sm:text-4xl">Your event desk</h1><p className="max-w-xl text-sm leading-6 text-navy-100">A dedicated workspace for your campus events. Your event assignment applies only to its own workspace.</p></div></section>}
    {!token ? <section className="rounded-2xl border border-line bg-white p-7"><h2 className="mb-2 text-xl font-semibold">Sign in to continue</h2><p className="mb-5 text-sm text-ink-muted">Sign in to your E-Balik account, then open Event desk from your account menu.</p><a href="/" className={button}>Open E-Balik sign in</a></section> : <>
      {error && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
      <EventCustodyInbox />
      <EventTagItems scope="office" title="Event item office handovers"/>
      {selected ? <EventDeskWorkspace key={selected.event.event_id} desk={selected} onBack={() => setSelected(null)} /> : loading ? <p role="status" className="rounded-2xl border border-line bg-white p-7 text-sm text-ink-muted">Verifying your current event access…</p> : !error && !workspaces.length ? <section className="rounded-2xl border border-dashed border-line-strong bg-white p-9 text-center"><Users className="mx-auto mb-4 text-gold-600" size={30} /><h2 className="mb-2 text-lg font-semibold">No open assignments</h2><p className="text-sm leading-6 text-ink-muted">Your administrator must assign you to a scheduled or open event. Draft, expired, cancelled and closed events stay hidden.</p></section> : <div className="grid gap-5 md:grid-cols-2">{workspaces.map((desk) => <article key={desk.event.event_id} className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm"><div className="border-b border-line p-6" style={{ background: 'linear-gradient(135deg,var(--surface-solid,#fff),var(--color-frost-100,#f1f4f9))' }}><div className="mb-4 flex flex-wrap gap-2"><span className="rounded-full bg-navy-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">{desk.event.status}</span><span className="rounded-full border border-gold-500/40 bg-gold-100 px-3 py-1 text-xs font-semibold text-navy-800">{desk.role === 'manager' ? 'Event manager' : 'Desk staff'}</span></div><h2 className="break-words text-xl font-semibold text-navy-900">{desk.event.name}</h2><p className="mt-1 text-sm text-ink-muted">{desk.event.organizer_name}</p></div><div className="space-y-4 p-6 text-sm"><p className="flex items-center gap-2 font-medium"><MapPin size={17} />{desk.event.venue}</p><p className="whitespace-pre-wrap break-words leading-6 text-ink-muted">{desk.event.desk_instructions}</p><dl className="space-y-3 rounded-xl bg-frost-100 p-4">{[['Starts', desk.event.starts_at], ['Ends', desk.event.ends_at], ['Final claiming', desk.event.recovery_ends_at], ['Your access ends', desk.expires_at]].map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-ink-muted">{label} · Manila</dt><dd className="mt-1 flex items-center gap-2 font-medium"><CalendarDays size={14} />{date(value)}</dd></div>)}</dl><p className="rounded-xl border border-gold-500/25 bg-gold-100/40 p-3 text-xs leading-5 text-navy-800">Event-only reports and physical intake. Campus reports remain separate.</p><button type="button" className={button + ' w-full'} onClick={() => setSelected(desk)}>Open event desk</button></div></article>)}</div>}
    </>}
  </div></main>;
}
