import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, RefreshCw, ShieldCheck } from 'lucide-react';
import { BTN, INPUT } from '../../components/ui/primitives';
import AdminModal from '../../components/ui/AdminModal';
import { fetchEventReview, transitionEvent, type EventDraft, type EventReview, type EventStatus } from './eventsApi';
import type { SetupStep } from './EventSetupTabs';
import EventPortalControl from './EventPortalControl';
import EventManagementPanel from './EventManagementPanel';
import EventOperationsPanel from './EventOperationsPanel';
import EventOperatorPanel from './EventOperatorPanel';

const LABELS: Record<EventStatus, string> = { draft: 'Return to draft', scheduled: 'Schedule event', active: 'Start event', recovery: 'Begin recovery', closed: 'Close event', archived: 'Archive event', cancelled: 'Cancel event' };
const time = (value: string) => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });

export default function EventReviewPanel({ event, visible, disabled, onStep, onChange, onBusyChange }: { event: EventDraft; visible: boolean; disabled: boolean; onStep: (step: SetupStep) => void; onChange: (event: EventDraft) => void; onBusyChange: (busy: boolean) => void }) {
  const [review, setReview] = useState<EventReview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<EventStatus | null>(null);
  const [note, setNote] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    setLoading(true); setReview(null);
    fetchEventReview(event.event_id).then((value) => { if (current) setReview(value); }).catch((e) => { if (current) setError(e instanceof Error ? e.message : 'Unable to review event.'); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [event.event_id, event.version, visible, revision]);
  const confirm = async () => {
    if (!target || !review) return;
    setBusy(true); onBusyChange(true); setError('');
    try { const updated = await transitionEvent(review.event, target, note.trim()); onChange(updated); setTarget(null); setNote(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to change event state.'); setRevision((value) => value + 1); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <div className="event-review">
    <div className="event-panel-heading flex items-start justify-between gap-3"><div><h3>Ready for the next chapter</h3><p>Review the saved setup, then choose the next event state.</p></div><button type="button" aria-label="Refresh event readiness" className={BTN.ghost} disabled={disabled || busy || loading} onClick={() => setRevision((v) => v + 1)}><RefreshCw size={16} /></button></div>
    {error && <p role="alert" className="event-review-error">{error}</p>}
    {disabled && <p className="event-panel-note">Save your changes before reviewing or changing state.</p>}
    {loading && <p role="status" className="event-panel-note">Checking saved event details…</p>}
    {review && <>
      <div className="event-review-summary"><ShieldCheck size={22} /><div><strong>{review.event.status.toUpperCase()} · {review.ready ? 'Setup complete' : 'Review setup'}</strong><p>State changes control your event workspace. Opening the attendee page is a separate action below.</p></div></div>
      {!review.lifecycle_available && <p className="event-panel-note">Lifecycle controls require the user-run migration <code>20261116_event_lifecycle.sql</code>. Draft setup still works.</p>}
      <details className="event-readiness" open={['draft', 'scheduled'].includes(review.event.status)}><summary>Readiness checks</summary><div className="event-review-checks">{review.checks.map((check) => <button type="button" key={check.id} disabled={busy} onClick={() => onStep(check.step)}>{check.ok ? <CheckCircle2 size={18} /> : <Circle size={18} />}<span>{check.label}</span><small>{check.ok ? 'Ready' : 'Review'}</small></button>)}</div></details>
      <div className="event-review-actions">{review.actions.filter((status) => status !== 'archived' || !review.management_available).map((status) => <button type="button" key={status} className={status === 'cancelled' ? BTN.ghost : BTN.primary} disabled={disabled || busy || loading} onClick={() => { setTarget(status); setNote(''); }}>{LABELS[status]}</button>)}</div>
      <EventPortalControl event={review.event} available={review.reports_available} open={review.portal_open} disabled={disabled || busy || loading} onChange={onChange} onBusyChange={onBusyChange} />
      <EventManagementPanel event={review.event} available={review.management_available} disabled={disabled || busy || loading} onChange={onChange} onBusyChange={onBusyChange} />
      <EventOperationsPanel event={review.event} disabled={disabled || busy || loading} onBusyChange={onBusyChange} />
      <EventOperatorPanel event={review.event} disabled={disabled || busy || loading} />
      <details className="event-history"><summary>How event states work</summary><p className="event-panel-note">Logo and cover artwork are optional. Scheduling locks details and artwork. Before the start time, return to draft to edit them. An administrator starts the event manually during its scheduled hours. Begin recovery after the event ends; close after the final claiming date; archive after closing. Cancellation ends staff access and is final in this release.</p></details>
      {review.actions.length === 0 && review.lifecycle_available && <p className="event-panel-note">No state change is available now. Check the schedule and readiness, then refresh.</p>}
      {['scheduled', 'active', 'recovery'].includes(review.event.status) && <p className="event-panel-note">Assigned staff can sign in and open <code>/event-desk</code>. Their access ends at their assignment expiry or the final claiming date, whichever comes first.</p>}
      <details className="event-history"><summary>State history ({review.history.length}{review.history.length === 100 ? '+' : ''})</summary>{review.history.length ? <ol>{review.history.map((entry) => <li key={entry.history_id}><strong>{entry.from_status} → {entry.to_status}</strong><time>{time(entry.created_at)} · Manila</time><p>{entry.note}</p></li>)}</ol> : <p className="event-panel-note">Your first state change will appear here.</p>}</details>
    </>}
    {target && <AdminModal title={LABELS[target]} description="This changes event access. The attendee portal has a separate setting and closes when the event is closed or cancelled." tone={target === 'cancelled' ? 'danger' : 'gold'} busy={busy} onClose={() => setTarget(null)} footer={<><button type="button" className={BTN.ghost} disabled={busy} onClick={() => setTarget(null)}>Back</button><button type="button" className={BTN.primary} disabled={busy || note.trim().length < 5 || note.length > 1000 || /[<>\x00-\x1f]/.test(note)} onClick={() => void confirm()}>{busy ? 'Saving…' : LABELS[target]}</button></>}>
      <p className="mb-4 text-sm text-ink-muted">{target === 'cancelled' ? 'Cancellation ends staff workspace access and is final in this release.' : target === 'archived' ? 'Archiving is final in this release.' : target === 'scheduled' ? 'Staff may view the workspace immediately. Start the event manually when its start time arrives.' : 'The server checks the latest state, schedule, manager assignment and event version before saving.'}</p>
      {error && <p role="alert" className="event-review-error">{error}</p>}
      <label className="block text-sm font-medium text-ink">Reason for this change<input autoFocus className={INPUT + ' mt-2'} value={note} minLength={5} maxLength={1000} placeholder="A short note for your event history" onChange={(e) => setNote(e.target.value)} /></label>
    </AdminModal>}
  </div>;
}
