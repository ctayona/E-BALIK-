import { useState } from 'react';
import { Download, BookOpen } from 'lucide-react';
import type { DeskInfo } from './eventApi';
import { downloadDeskPack, OPERATOR_SECTIONS, type OperatorSection } from './operatorGuide';
import './operatorGuide.css';

export default function EventOperatorGuide({ desk, onNavigate }: { desk: DeskInfo; onNavigate: (panel: 'reports' | 'matches' | 'claims' | 'summary') => void }) {
  const [section, setSection] = useState<OperatorSection>('desk');
  const [message, setMessage] = useState('');
  const selected = OPERATOR_SECTIONS.find((item) => item.id === section)!;
  const download = () => { try { downloadDeskPack(desk.event); setMessage('Desk pack downloaded. Open the HTML file and use Print to print or save as PDF. Keep completed sheets in staff custody.'); } catch { setMessage('The download could not start. Try again from this guide.'); } };
  return <section className="event-operator-guide" aria-label="Event operator guide">
    <header><div><span className="event-operator-eyebrow">STAFF FIELD GUIDE</span><h3><BookOpen size={21} />A confident shift, from start to finish</h3><p>Use the existing event workflows below. Download the blank desk pack before your shift for offline reference and manual intake.</p></div><button className="ev-button" onClick={download}><Download size={16} />Download desk pack</button></header>
    {message && <p role="status" className="event-operator-note">{message}</p>}
    <nav aria-label="Operator guide chapters">{OPERATOR_SECTIONS.map((item) => <button key={item.id} aria-pressed={section === item.id} onClick={() => setSection(item.id)}>{item.title}</button>)}</nav>
    <ol aria-label={selected.title}>{selected.steps.map(([title, body], index) => <li key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h4>{title}</h4><p>{body}</p></div></li>)}</ol>
    <div className="event-operator-links" aria-label="Open existing event workflow">{desk.reports_available && <><button className="ev-button" onClick={() => onNavigate('reports')}>Reports and intake</button><button className="ev-button" onClick={() => onNavigate('matches')}>Possible matches</button></>}{desk.claims_available && <button className="ev-button" onClick={() => onNavigate('claims')}>Ownership claims</button>}{desk.operations_available && desk.role === 'manager' && <button className="ev-button" onClick={() => onNavigate('summary')}>Recovery summary</button>}</div>
    <p className="event-operator-note">This guide grants no additional access. Your assignment, event state and the server's current permission checks still apply. Event QR links and reports remain separate from campus Smart Tags.</p>
  </section>;
}
