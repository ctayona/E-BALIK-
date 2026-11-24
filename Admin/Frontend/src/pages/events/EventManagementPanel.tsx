import { useState } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import { BTN } from '../../components/ui/primitives';
import type { EventDraft } from './eventsApi';
import EventManageDialog, { type ManageAction } from './EventManageDialog';

export default function EventManagementPanel({ event, available, disabled, onChange, onBusyChange }: { event: EventDraft; available: boolean; disabled: boolean; onChange: (event: EventDraft) => void; onBusyChange: (busy: boolean) => void }) {
  const [action, setAction] = useState<ManageAction | null>(null);
  return <details className="event-history"><summary>Workspace management</summary>{!available ? <p className="event-panel-note">Archiving/deletion controls require 20261116c_event_recovery.sql. Saved drafts remain editable.</p> : <><p className="event-panel-note">Archive completed events or move inactive events to Deleted. Reports and history are retained; ongoing events must be closed or cancelled first.</p><div className="event-review-actions">{['draft', 'closed', 'cancelled'].includes(event.status) && <button type="button" className={BTN.ghost} disabled={disabled} onClick={() => setAction('archive')}><Archive size={15} />Archive event</button>}{event.status === 'archived' && <button type="button" className={BTN.ghost} disabled={disabled} onClick={() => setAction('restore')}>Restore from archive</button>}{event.status === 'archived' && <button type="button" className={BTN.ghost} disabled={disabled} onClick={() => setAction('delete')}><Trash2 size={15} />Move to Deleted</button>}</div></>}{action && <EventManageDialog event={event} action={action} onClose={() => setAction(null)} onChanged={onChange} onBusyChange={onBusyChange} />}</details>;
}
