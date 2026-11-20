import { useState } from 'react';
import { BookOpen, Download } from 'lucide-react';
import AdminModal from '../../components/ui/AdminModal';
import { BTN } from '../../components/ui/primitives';
import type { EventDraft } from './eventsApi';
import { downloadDeskPack, OPERATOR_SECTIONS, type OperatorSection } from '../../../../../Users/Frontend/src/app/pages/event-desk/operatorGuide';
import '../../../../../Users/Frontend/src/app/pages/event-desk/operatorGuide.css';

export default function EventOperatorPanel({ event, disabled }: { event: EventDraft; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<OperatorSection>('prepare');
  const [message, setMessage] = useState('');
  const selected = OPERATOR_SECTIONS.find((item) => item.id === section)!;
  const download = () => { try { downloadDeskPack(event); setMessage('Desk pack downloaded. Open the HTML file and use Print to print or save as PDF. Brief staff and fill in the escalation contact before the pilot.'); } catch { setMessage('The download could not start. Try again from this guide.'); } };
  return <div className="event-operations-entry"><div><BookOpen size={22} /><div><strong>Prepare your event team</strong><p>A shared desk guide, incident procedures and printable manual intake sheets.</p></div></div><button className={BTN.ghost} disabled={disabled} onClick={() => { setMessage(''); setOpen(true); }}>Open operator guide</button>{open && <AdminModal title="Event operator guide" description={event.name + ' · Brief staff before opening the attendee portal.'} icon={<BookOpen size={24} />} tone="gold" size="xl" onClose={() => setOpen(false)} footer={<><button className={BTN.ghost} onClick={() => setOpen(false)}>Close guide</button><button className={BTN.primary} onClick={download}><Download size={16} />Download desk pack</button></>}><div className="event-operator-guide"><p className="event-operator-note">Use Review for event state and portal controls. Operations contains hub visibility, custody handovers and the closing plan. Staff use their assigned event desk; a guide is not a launch approval.</p>{message && <p role="status" className="event-operator-note">{message}</p>}<nav aria-label="Operator guide chapters">{OPERATOR_SECTIONS.map((item) => <button key={item.id} aria-pressed={section === item.id} onClick={() => setSection(item.id)}>{item.title}</button>)}</nav><ol aria-label={selected.title}>{selected.steps.map(([title, body], index) => <li key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h4>{title}</h4><p>{body}</p></div></li>)}</ol></div></AdminModal>}</div>;
}
