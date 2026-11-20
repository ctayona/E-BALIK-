import { useState } from 'react';
import { Globe } from 'lucide-react';
import { BTN, INPUT } from '../../components/ui/primitives';
import AdminModal from '../../components/ui/AdminModal';
import { setEventPortal, type EventDraft } from './eventsApi';
import EventShareControls from './EventShareControls';

export default function EventPortalControl({ event, available, open, disabled, onChange, onBusyChange }: { event: EventDraft; available: boolean; open: boolean; disabled: boolean; onChange: (event: EventDraft) => void; onBusyChange: (busy: boolean) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const enabling = !event.portal_enabled;
  const allowed = available && (event.portal_enabled || ['active', 'recovery'].includes(event.status) && Date.now() < Date.parse(event.recovery_ends_at || ''));
  const save = async () => {
    setBusy(true); onBusyChange(true); setError('');
    try { const next = await setEventPortal(event, enabling, note); onChange(next); setConfirm(false); setNote(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to change portal access.'); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <section className="event-portal-control"><header><Globe size={20} /><div><h4>Attendee event page</h4><p>{open ? 'Open for verified E-Balik attendees. Reports stay inside this event.' : event.portal_enabled ? 'Portal setting is enabled, but the event state or recovery deadline currently closes access.' : 'Closed until you explicitly open it after starting the event.'}</p></div></header>
    {!available ? <p className="event-panel-note">Run the user-applied migration <code>20261116b_event_reports.sql</code> to enable event reports and desk intake.</p> : <><EventShareControls key={event.event_id} event={event} disabled={disabled || busy} /><div className="event-review-actions"><button type="button" className={BTN.primary} disabled={disabled || busy || !allowed} onClick={() => { setConfirm(true); setError(''); }}>{event.portal_enabled ? 'Pause attendee portal' : 'Open attendee portal'}</button></div></>}
    {error && !confirm && <p role="alert" className="event-review-error">{error}</p>}
    {confirm && <AdminModal title={enabling ? 'Open attendee portal?' : 'Pause attendee portal?'} description={enabling ? 'Your saved event identity, branding, dates and collection instructions become accessible through its event link. Verified accounts can submit and browse moderated event reports.' : 'The event page and new attendee submissions close. Assigned staff retain desk access; existing reports and history stay intact.'} icon={<Globe size={22} />} tone="gold" busy={busy} onClose={() => setConfirm(false)} footer={<><button type="button" className={BTN.ghost} disabled={busy} onClick={() => setConfirm(false)}>Back</button><button type="button" className={BTN.primary} disabled={busy || note.trim().length < 5 || /[<>\x00-\x1f]/.test(note)} onClick={() => void save()}>{busy ? 'Saving…' : enabling ? 'Open portal' : 'Pause portal'}</button></>}>
      {error && <p role="alert" className="event-review-error">{error}</p>}<label className="block text-sm font-medium text-ink">Reason<input className={INPUT + ' mt-2'} minLength={5} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why are you opening or pausing this page?" /></label><p className="event-panel-note">Publishing an event page never posts reports to the main campus hub. Managers review each generic board label; private descriptions and report photos stay restricted.</p>
    </AdminModal>}
  </section>;
}
