import { useEffect, useRef, useState } from 'react';
import { ClipboardList, GitCompareArrows, Image } from 'lucide-react';
import Modal from '@/app/shared/modal/Modal';
import { manila, reportAction, reportDetail, reportPhoto, type DeskInfo, type ReportAction, type ReportDetail } from './eventApi';

export default function EventReportDialog({ desk, reportId, onClose, onChanged, onClaims, onMatches }: { desk: DeskInfo; reportId: string; onClose: () => void; onChanged: () => void; onClaims?: () => void; onMatches?: () => void }) {
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<ReportAction | ''>('');
  const [note, setNote] = useState('');
  const [label, setLabel] = useState('');
  const [storage, setStorage] = useState('');
  const [received, setReceived] = useState(false);
  const [photo, setPhoto] = useState('');
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [revision, setRevision] = useState(0);
  const photoRequest = useRef<AbortController | null>(null);
  useEffect(() => () => photoRequest.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController(); setDetail(null); setAction('');
    reportDetail(desk.event.event_id, reportId, controller.signal).then((value) => { if (!controller.signal.aborted) { setDetail(value); setLabel(value.report.public_label || ''); } }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load report.'); });
    return () => controller.abort();
  }, [desk.event.event_id, reportId, revision]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
  useEffect(() => { if (!busy) return; const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [busy]);
  const save = async () => {
    if (!detail || !action) return;
    setBusy(true); setError('');
    try {
      const data: Record<string, string> = { note };
      if (action === 'approve') data.public_label = label;
      if (action === 'receive') data.storage_location = storage;
      await reportAction(desk.event.event_id, detail.report, action, data);
      onChanged(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save action.'); setRevision((v) => v + 1); }
    finally { setBusy(false); }
  };
  const loadPhoto = async () => {
    const controller = new AbortController(); photoRequest.current?.abort(); photoRequest.current = controller;
    setLoadingPhoto(true); setError('');
    try { const image = await reportPhoto(desk.event.event_id, reportId, controller.signal); if (!controller.signal.aborted) setPhoto(URL.createObjectURL(image)); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load private photo.'); }
    finally { if (!controller.signal.aborted) setLoadingPhoto(false); }
  };
  const active = ['active', 'recovery'].includes(desk.event.status) && Date.now() < Date.parse(desk.event.recovery_ends_at);
  const canSave = !!action && note.trim().length >= 5 && !/[<>\x00-\x1f]/.test(note) && (action !== 'approve' || label.trim().length >= 3 && !/@|\d{6,}|[<>\x00-\x1f]/.test(label)) && (action !== 'receive' || received && storage.trim().length >= 3);
  return <Modal open onClose={onClose} dismissible={!busy && !loadingPhoto} title={detail?.report.item_name || 'Event report'} eyebrow={detail?.report.reference || 'EVENT DESK'} icon={<ClipboardList size={23} />} size="lg" description="Private details and notes are restricted to assigned event staff." footer={<><button className="ev-button" disabled={busy || loadingPhoto} onClick={onClose}>Close</button>{action && <button className="ev-button ev-button-primary" disabled={busy || !canSave} onClick={() => void save()}>{busy ? 'Saving…' : 'Confirm action'}</button>}</>}>
    <div className="ev-dialog-content">{error && <p role="alert" className="ev-alert">{error}</p>}{!detail ? !error && <p role="status">Loading private report…</p> : <>
      <div className="ev-report-badges"><span>{detail.report.kind === 'found' ? 'Found item' : 'Missing item'}</span><span>{detail.report.withdrawn_at ? 'Withdrawn' : detail.report.moderation_status}</span><span>{detail.report.released_at ? 'Released to owner' : detail.report.received_at ? 'In desk custody' : 'No desk receipt recorded'}</span></div>
      <dl className="ev-detail-grid"><div><dt>Category</dt><dd>{detail.report.category}</dd></div><div><dt>Location</dt><dd>{detail.report.venue} · {detail.report.location_details || 'No further directions'}</dd></div><div><dt>Incident time · Manila</dt><dd>{manila(detail.report.occurred_at)}</dd></div><div><dt>Physical receipt</dt><dd>{detail.report.received_at ? manila(detail.report.received_at) : 'Not yet received'}</dd></div>{detail.report.storage_location && <div><dt>Private storage position</dt><dd>{detail.report.storage_location}</dd></div>}</dl>
      <p className="ev-private-description">{detail.report.description}</p>
      {detail.report.has_photo && <div className="ev-private-photo">{photo ? <img src={photo} alt="Private item evidence" /> : <button className="ev-button" disabled={loadingPhoto || busy} onClick={() => void loadPhoto()}><Image size={16} />{loadingPhoto ? 'Loading…' : 'View private photo'}</button>}</div>}
      {desk.claims_available && detail.report.kind === 'found' && onClaims && <button className="ev-button ev-button-primary" onClick={onClaims}>Ownership claims for this item</button>}
      {onMatches && !detail.report.withdrawn_at && !detail.report.released_at && detail.report.moderation_status !== 'hidden' && <button className="ev-button" disabled={busy || loadingPhoto} onClick={onMatches}><GitCompareArrows size={15} />Find possible matches</button>}
      {active && !detail.report.withdrawn_at && !detail.report.released_at && <div className="ev-desk-actions"><h3>Record the next step</h3><div className="ev-action-options">{(desk.role === 'manager' ? ['approve', 'hide', 'receive', 'note'] : ['receive', 'note']).filter((option) => option !== 'receive' || detail.report.kind === 'found' && !detail.report.received_at).map((option) => <button key={option} className={'ev-button ' + (action === option ? 'ev-button-selected' : '')} disabled={busy} onClick={() => { setAction(option as ReportAction); setNote(''); setReceived(false); }}>{({ approve: 'Approve for event board', hide: 'Hide from board', receive: 'Receive item', note: 'Add private note' } as Record<string, string>)[option]}</button>)}</div>
        {action && <div className="ev-form-grid"><p className="ev-wide ev-help">{action === 'approve' ? 'Publish only a generic item label, category, venue and incident time in this event. Keep names, serial numbers, IDs and contact details private. This does not publish to the main E-Balik hub.' : action === 'hide' ? 'Hide this report from the event board. Its private history and physical custody stay intact.' : action === 'receive' ? 'Use only after the physical item has arrived at your desk. Report submission alone does not establish custody.' : 'This note is visible only to assigned event staff.'}</p>
          {action === 'approve' && <label className="ev-wide">Generic public item label<input maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Black backpack" /></label>}
          {action === 'receive' && <><label className="ev-wide">Actual storage position<input maxLength={160} value={storage} onChange={(e) => setStorage(e.target.value)} placeholder="e.g. Desk A, secured bin 3" /></label><label className="ev-check ev-wide"><input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} /><span>I have physically received this item at the event collection desk.</span></label></>}
          <label className="ev-wide">Private audit note<input maxLength={1000} minLength={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain what you checked or received" /></label>
        </div>}
      </div>}
      <details className="ev-history"><summary>Report history ({detail.history.length}{detail.history.length === 100 ? '+' : ''})</summary><ol>{detail.history.map((entry) => <li key={entry.history_id}><strong>{entry.action}</strong><time>{manila(entry.created_at)} · Manila</time><p>{entry.note}</p></li>)}</ol></details>
    </>}</div>
  </Modal>;
}
