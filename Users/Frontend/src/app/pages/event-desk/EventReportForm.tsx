import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CheckCircle2 } from 'lucide-react';
import Modal from '@/app/shared/modal/Modal';
import { attendeeSubmit, submitReport, dateControl, type EventInfo, type ReportInput } from './eventApi';
import './eventPages.css';

export default function EventReportForm({ event, slug, categories, venues, kind, onClose, onSaved }: { event: EventInfo; slug?: string; categories: string[]; venues: string[]; kind: 'missing' | 'found'; onClose: () => void; onSaved: () => void }) {
  const requestId = useRef(crypto.randomUUID());
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({ item_name: '', category: '', description: '', venue: event.venue, location_details: '', occurred_at: dateControl(new Date(Math.max(Date.parse(event.starts_at), Math.min(Date.now(), Date.parse(event.ends_at)))).toISOString()) });
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [ack, setAck] = useState(false);
  const dirty = !!(values.item_name || values.description || photo);
  useEffect(() => { if (!busy && !dirty) return; const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, busy]);
  const close = () => { if (!busy && (saved || !dirty || window.confirm('Discard this unfinished event report?'))) onClose(); };
  const validate = () => {
    if (values.item_name.trim().length < 3 || !categories.includes(values.category) || values.description.trim().length < 10) return 'Enter an item name, choose its category and add at least 10 characters of private description.';
    if (!venues.includes(values.venue) || !values.occurred_at) return 'Choose a university venue and the incident time.';
    const stamp = Date.parse(values.occurred_at + ':00+08:00');
    if (!Number.isFinite(stamp) || stamp < Date.parse(event.starts_at) || stamp > Math.min(Date.now(), Date.parse(event.ends_at))) return 'The incident time must be during the event and cannot be in the future.';
    if (Object.values(values).some((value) => /[<>\x00-\x1f]/.test(value))) return 'Use plain text without angle brackets or line breaks.';
    return '';
  };
  const save = async (e: FormEvent) => {
    e.preventDefault(); const issue = validate(); if (issue) { setError(issue); return; } if (!ack) { setError('Confirm that the report is accurate before submitting.'); return; }
    setBusy(true); setError('');
    try {
      const input: ReportInput = { ...values, board_consent: true, kind, request_id: requestId.current, occurred_at: new Date(values.occurred_at + ':00+08:00').toISOString() };
      const result = slug ? await attendeeSubmit(slug, input, photo) : await submitReport(event.event_id, input, photo);
      setSaved(result.report.reference);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to submit your event report.'); }
    finally { setBusy(false); }
  };
  return <Modal open onClose={close} dismissible={!busy} title={saved ? 'Report received' : kind === 'missing' ? 'Report a missing item' : 'Report a found item'} eyebrow={event.name} description={saved ? 'Your report stays in this event.' : 'A clear report helps your event team make the right connection.'} icon={saved ? <CheckCircle2 size={23} /> : <Camera size={23} />} tone="gold" size="lg" footer={saved ? <button className="ev-button ev-button-primary" onClick={() => { onSaved(); onClose(); }}>Done</button> : <><button type="button" className="ev-button" disabled={busy} onClick={() => step === 0 ? close() : setStep(0)}>{step === 0 ? 'Cancel' : 'Back'}</button>{step === 0 ? <button type="button" className="ev-button ev-button-primary" onClick={() => { const issue = validate(); setError(issue); if (!issue) setStep(1); }}>Review report</button> : <button type="submit" form="event-report-form" className="ev-button ev-button-primary" disabled={busy || !ack}>{busy ? 'Submitting…' : 'Submit report'}</button>}</>}>
    <div className="ev-dialog-content">{error && <p role="alert" className="ev-alert">{error}</p>}
      {saved ? <div className="ev-success"><CheckCircle2 size={36} /><h3>{saved}</h3><p>Keep this reference. Your report is awaiting manager review. Submitted details and photos are private to you and assigned event staff.</p><p>Reporting a found item does not record physical receipt. Take it to the collection desk: {event.desk_instructions}</p></div> : <form id="event-report-form" noValidate onSubmit={(e) => void save(e)}>
        <div className="ev-step-indicator"><span className={step === 0 ? 'active' : ''}>01 · Item details</span><span className={step === 1 ? 'active' : ''}>02 · Review & submit</span></div>
        {step === 0 ? <fieldset className="ev-form-grid" disabled={busy}>
          <label className="ev-wide">Item name<input maxLength={120} value={values.item_name} placeholder="e.g. Black backpack" onChange={(e) => setValues({ ...values, item_name: e.target.value })} /></label>
          <label>Category<select value={values.category} onChange={(e) => setValues({ ...values, category: e.target.value })}><option value="">Choose a category</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>University venue<select value={values.venue} onChange={(e) => setValues({ ...values, venue: e.target.value })}>{venues.map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="ev-wide">Private description<textarea rows={3} maxLength={2000} value={values.description} placeholder="Describe identifying features. These details are shared with event staff, not the event board." onChange={(e) => setValues({ ...values, description: e.target.value })} /></label>
          <label>Lost / found at · Manila time<input type="datetime-local" min={dateControl(event.starts_at)} max={dateControl(new Date(Math.min(Date.now(), Date.parse(event.ends_at))).toISOString())} value={values.occurred_at} onChange={(e) => setValues({ ...values, occurred_at: e.target.value })} /></label>
          <label>Exact location · optional<input maxLength={300} value={values.location_details} placeholder="e.g. Beside the entrance" onChange={(e) => setValues({ ...values, location_details: e.target.value })} /></label>
          <label className="ev-wide">Private photo · optional<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0] || null; if (file && (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError('Choose a JPG, PNG or WebP image up to 5 MB.'); e.target.value = ''; setPhoto(null); } else { setPhoto(file); setError(''); } }} /><small>Only you and assigned event staff can view this image. Avoid photographing faces, IDs or private messages.</small></label>
        </fieldset> : <div className="ev-report-review"><strong>{values.item_name}</strong><p>{values.category} · {values.venue}</p><p>{values.description}</p><p>{photo ? 'A private photo is included.' : 'No photo attached.'}</p><label className="ev-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>I confirm this report is accurate and relates to this event. A manager may publish a generic item label, category and venue to this event’s board. My private description and photo stay restricted.</span></label></div>}
      </form>}
    </div>
  </Modal>;
}
