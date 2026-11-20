import { useCallback, useEffect, useState } from 'react';
import { Search, UserPlus, Users, ShieldCheck } from 'lucide-react';
import { BTN, INPUT, Field } from '../../components/ui/primitives';
import AdminModal from '../../components/ui/AdminModal';
import { assignEventMember, fetchEventMembers, findEventPerson, revokeEventMember, type EventDraft, type EventPerson, type EventMember } from './eventsApi';
import { customStaffExpiry, manilaInput, manilaLabel, staffExpiryProblem } from './eventDates';

export default function EventStaffPanel({ event, disabled, onBusyChange, onEditSchedule }: { event: EventDraft; disabled: boolean; onBusyChange: (busy: boolean) => void; onEditSchedule: () => void }) {
  const [rows, setRows] = useState<EventMember[]>([]);
  const [email, setEmail] = useState('');
  const [person, setPerson] = useState<EventPerson | null>(null);
  const [role, setRole] = useState<EventMember['role']>('desk_staff');
  const [expiry, setExpiry] = useState('');
  const [expiryMode, setExpiryMode] = useState<'event' | 'custom'>(event.recovery_ends_at ? 'event' : 'custom');
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revoke, setRevoke] = useState<EventMember | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchEventMembers(event.event_id)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load event team.'); }
    finally { setLoading(false); }
  }, [event.event_id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const ends = expiryMode === 'event' ? event.recovery_ends_at : customStaffExpiry(expiry);
  const expiryProblem = staffExpiryProblem(ends, event.recovery_ends_at, now);
  const recoveryClosed = Boolean(event.recovery_ends_at && Date.parse(event.recovery_ends_at) <= now);
  const action = async (work: () => Promise<unknown>, success = '') => {
    setBusy(true); onBusyChange(true); setError(''); setNotice('');
    try { await work(); if (success) { await load(); setNotice(success); } }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to update event team.'); }
    finally { setBusy(false); onBusyChange(false); }
  };
  const assign = () => {
    if (!person) { setError('Find an existing active account first.'); return; }
    const problem = staffExpiryProblem(ends, event.recovery_ends_at);
    if (problem || !ends) { setError(problem || 'Choose when staff access ends.'); return; }
    void action(async () => { await assignEventMember(event.event_id, person.account_id, role, ends); setPerson(null); setEmail(''); setExpiry(''); }, 'Event staff assignment saved.');
  };
  return <section className="event-editor space-y-4 rounded-2xl border border-line bg-[var(--surface)] p-5 sm:p-6">
    <div className="event-studio-section"><span><Users size={15} /></span><h3>Your event team</h3></div>
    <p className="text-sm leading-6 text-ink-muted">Assign existing accounts for this event only. Their campus permissions stay the same. Assigned staff can view scheduled and open workspaces at /event-desk; attendee reporting remains closed.</p>
    {disabled && !busy && <p className="text-xs text-ink-muted">Save or discard event changes before managing the team.</p>}
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <div className="rounded-xl border border-gold-500/25 bg-gold-500/5 p-3 text-sm text-ink-soft"><strong>Event access window</strong><p className="mt-1 leading-6">{event.recovery_ends_at ? `Staff access can run until ${manilaLabel(event.recovery_ends_at)}.` : 'No final claiming date is set yet. Choose a custom future expiry, or set the event Schedule.'}</p>{recoveryClosed && <p className="mt-1 font-medium">This deadline has passed. Extend the final claiming date before assigning staff.</p>}<button type="button" className="mt-2 text-xs font-semibold underline" disabled={busy || disabled} onClick={onEditSchedule}>Edit event schedule</button></div>
    <fieldset disabled={disabled || busy || loading} className="space-y-4 disabled:opacity-60">
      <Field label="Existing account email" hint="Enter the exact email used to sign in to E-Balik.">{(id) => <div className="flex gap-2"><input id={id} className={INPUT} type="email" maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setPerson(null); }} /><button type="button" className={BTN.ghost} disabled={!email.trim()} onClick={() => void action(async () => setPerson(await findEventPerson(event.event_id, email)))}><Search size={16} />Find</button></div>}</Field>
      {person && <div className="rounded-xl border border-gold-500/30 bg-gold-500/5 p-3"><strong className="text-sm text-ink">{[person.fname, person.lname].filter(Boolean).join(' ') || 'E-Balik member'}</strong><p className="break-all text-xs text-ink-muted">{person.email}</p></div>}
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Event role">{(id) => <select id={id} className={INPUT} value={role} onChange={(e) => setRole(e.target.value as EventMember['role'])}><option value="desk_staff">Desk staff</option><option value="manager">Event manager</option></select>}</Field><Field label="Staff access ends" hint="This ends the assignment for this event, not the person's campus access.">{(id) => <select id={id} className={INPUT} value={expiryMode} onChange={(e) => { setExpiryMode(e.target.value as 'event' | 'custom'); setError(''); }}><option value="event" disabled={!event.recovery_ends_at}>Until final claiming date</option><option value="custom">Choose a custom date and time</option></select>}</Field></div>
      {expiryMode === 'custom' && <Field label="Custom expiry (Manila time)">{(id) => <input id={id} className={INPUT} type="datetime-local" min={manilaInput(new Date(Math.ceil((now + 1) / 60000) * 60000).toISOString())} max={event.recovery_ends_at ? manilaInput(event.recovery_ends_at) : undefined} value={expiry} aria-invalid={Boolean(expiry && expiryProblem)} aria-describedby="event-staff-expiry-feedback" onChange={(e) => { setExpiry(e.target.value); setError(''); }} />}</Field>}
      {(recoveryClosed || expiryMode === 'custom' && expiry) && expiryProblem && <p id="event-staff-expiry-feedback" role="status" className="text-sm leading-6 text-rose-700">{expiryProblem}</p>}
      <button type="button" className={BTN.primary} disabled={!person || Boolean(expiryProblem)} onClick={assign}><UserPlus size={16} />{busy ? 'Saving…' : 'Assign event staff'}</button>
    </fieldset>
    <div className="border-t border-line pt-4"><div className="mb-3 flex justify-between"><h4 className="text-sm font-semibold text-ink">Assignments</h4><button type="button" className="text-xs text-ink-muted underline" disabled={busy || loading} onClick={() => void load()}>Refresh</button></div>{loading ? <p role="status" className="text-sm text-ink-muted">Loading team…</p> : rows.length === 0 ? <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-muted">Your team starts here. Assign an existing account above.</p> : <ul className="event-team-list space-y-2">{rows.map((row) => {
      const status = row.status === 'revoked' ? 'Revoked' : Date.parse(row.expires_at) <= Date.now() ? 'Expired' : row.person?.is_active === false ? 'Account inactive' : 'Active';
      return <li key={row.membership_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3"><div className="min-w-0"><p className="text-sm font-medium text-ink">{row.person ? `${row.person.fname || ''} ${row.person.lname || ''}`.trim() || row.person.email : 'Account unavailable'}</p><p className="text-xs text-ink-muted">{row.role === 'manager' ? 'Event manager' : 'Desk staff'} · {status}</p><p className="mt-1 text-xs text-ink-muted">Until {new Date(row.expires_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p></div>{row.status !== 'revoked' && <button type="button" className={BTN.ghost} disabled={disabled || busy} onClick={() => setRevoke(row)}>Revoke</button>}</li>;
    })}</ul>}</div>
    {revoke && <AdminModal title="Revoke event access?" description="This removes this person's assignment for this event. Campus permissions are unchanged." icon={<ShieldCheck size={20} />} tone="danger" busy={busy} onClose={() => setRevoke(null)} footer={<><button type="button" className={BTN.ghost} disabled={busy} onClick={() => setRevoke(null)}>Cancel</button><button type="button" className={BTN.primary} disabled={busy} onClick={() => void action(async () => { await revokeEventMember(event.event_id, revoke.membership_id); setRevoke(null); }, 'Event access revoked.')}>Revoke access</button></>}><p className="text-sm text-ink-muted">You can assign this account again later with a new expiry.</p></AdminModal>}
  </section>;
}
