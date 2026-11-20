import { useState } from 'react';
import { Archive, RotateCcw, Trash2 } from 'lucide-react';
import AdminModal from '../../components/ui/AdminModal';
import { BTN, INPUT } from '../../components/ui/primitives';
import { manageEvent, transitionEvent, type EventDraft } from './eventsApi';

export type ManageAction = 'archive' | 'delete' | 'restore' | 'cancel';
export default function EventManageDialog({ event, action, onClose, onChanged, onBusyChange }: { event: EventDraft; action: ManageAction; onClose: () => void; onChanged: (event: EventDraft) => void; onBusyChange: (busy: boolean) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const labels = { archive: 'Archive event', delete: 'Move to Deleted', restore: 'Restore event', cancel: 'Cancel event' };
  const save = async () => {
    setBusy(true); onBusyChange(true); setError('');
    try { const row = action === 'cancel' ? await transitionEvent(event, 'cancelled', note.trim()) : await manageEvent(event, action, note.trim()); onChanged(row); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to manage this event.'); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <AdminModal title={labels[action]} description={event.name} tone={action === 'delete' || action === 'cancel' ? 'danger' : 'gold'} icon={action === 'archive' ? <Archive size={23} /> : action === 'restore' ? <RotateCcw size={23} /> : <Trash2 size={23} />} busy={busy} onClose={onClose} footer={<><button type="button" className={BTN.ghost} disabled={busy} onClick={onClose}>Back</button><button type="button" className={BTN.primary} disabled={busy || note.trim().length < 5 || /[<>\x00-\x1f]/.test(note)} onClick={() => void save()}>{busy ? 'Saving…' : labels[action]}</button></>}>
    <p className="mb-4 text-sm leading-6 text-ink-muted">{action === 'cancel' ? 'Cancellation is final: the attendee portal closes, staff operating access ends and open pickup claims expire. Reports and history stay available. After cancelling, you can move this event to Deleted if no unreleased items remain in custody, or archive it to retain its records.' : action === 'delete' ? 'This removes an inactive event from normal lists. Its reports, claims and audit history are retained, and it can be restored from Deleted. Events with unreleased items in desk custody cannot be deleted.' : action === 'archive' ? 'Archive a closed or cancelled event as a retained record. Attendee and staff operation stay closed, and open pickup claims expire.' : 'Restore this event to its previous state. Attendee access remains closed. A restored draft can be edited normally.'}</p>
    {error && <p role="alert" className="event-review-error">{error}</p>}<label className="block text-sm font-medium text-ink">Reason<input className={INPUT + ' mt-2'} maxLength={1000} minLength={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain this workspace change" /></label>
  </AdminModal>;
}
