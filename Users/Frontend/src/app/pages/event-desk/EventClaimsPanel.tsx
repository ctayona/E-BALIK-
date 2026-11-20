import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Image, RefreshCw, ShieldCheck } from 'lucide-react';
import Modal from '@/app/shared/modal/Modal';
import { claimAction, claimDetail, claimProof, staffClaims, type EventClaim, type ClaimDetail } from './recoveryApi';
import { manila, type DeskInfo } from './eventApi';
import EventReceiptDialog from './EventReceiptDialog';

function ClaimDialog({ desk, claimId, onClose, onChanged }: { desk: DeskInfo; claimId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<ClaimDetail | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [action, setAction] = useState<'approve' | 'reject' | 'release' | ''>('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState('');
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [receipt, setReceipt] = useState<EventClaim | null>(null);
  const photoRequest = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); setDetail(null); setAction(''); claimDetail(desk.event.event_id, claimId, controller.signal).then((data) => { if (!controller.signal.aborted) setDetail(data); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Claim unavailable.'); }); return () => controller.abort(); }, [desk.event.event_id, claimId, revision]);
  useEffect(() => () => { photoRequest.current?.abort(); }, []);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
  const loadPhoto = async () => { if (!detail) return; const controller = new AbortController(); photoRequest.current?.abort(); photoRequest.current = controller; setLoadingPhoto(true); try { const blob = await claimProof(detail.claim, controller.signal); if (!controller.signal.aborted) setPhoto(URL.createObjectURL(blob)); } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Proof unavailable.'); } finally { if (!controller.signal.aborted) setLoadingPhoto(false); } };
  const save = async () => {
    if (!detail || !action) return; setBusy(true); setError('');
    try { await claimAction(detail.claim, action, action === 'release' ? { note, pin, identity_checked: checked } : { note }); onChanged(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Claim action refused.'); setRevision((value) => value + 1); }
    finally { setBusy(false); }
  };
  const valid = note.trim().length >= 5 && !/[<>\x00-\x1f]/.test(note) && (action !== 'release' || checked && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(pin));
  return <Modal open onClose={onClose} dismissible={!busy && !loadingPhoto} title="Ownership claim review" eyebrow={detail?.claim.reference || 'EVENT RECOVERY'} icon={<ShieldCheck size={23} />} tone="gold" size="lg" footer={<><button className="ev-button" disabled={busy || loadingPhoto} onClick={onClose}>Close</button>{action && <button className="ev-button ev-button-primary" disabled={busy || !valid} onClick={() => void save()}>{busy ? 'Saving…' : action === 'release' ? 'Confirm physical release' : 'Save decision'}</button>}</>}>
    {error && <p className="ev-alert" role="alert">{error}</p>}{!detail ? !error && <p role="status">Loading private claim…</p> : <div className="ev-dialog-content"><div className="ev-report-badges"><span>{detail.claim.status}</span><span>{detail.claim.item_label}</span></div><dl><div><dt>Claimant</dt><dd>{detail.claim.claimant_name}</dd></div><div><dt>Submitted · Manila</dt><dd>{manila(detail.claim.created_at)}</dd></div></dl><h3>Private ownership evidence</h3><p className="ev-private-description">{detail.claim.evidence}</p>{detail.claim.has_proof && <div className="ev-private-photo">{photo ? <img src={photo} alt="Private claimant evidence" /> : <button className="ev-button" disabled={loadingPhoto || busy} onClick={() => void loadPhoto()}><Image size={15} />{loadingPhoto ? 'Loading…' : 'View private proof'}</button>}</div>}
      <div className="ev-action-options">{desk.role === 'manager' && detail.claim.status === 'pending' && <button className="ev-button" disabled={busy} onClick={() => { setAction('approve'); setNote(''); }}>Approve ownership</button>}{desk.role === 'manager' && ['pending', 'approved'].includes(detail.claim.status) && <button className="ev-button" disabled={busy} onClick={() => { setAction('reject'); setNote(''); }}>Reject claim</button>}{detail.claim.status === 'approved' && detail.claim.failed_attempts < 5 && <button className="ev-button ev-button-primary" disabled={busy} onClick={() => { setAction('release'); setNote(''); setPin(''); setChecked(false); }}>Release to claimant</button>}{detail.claim.status === 'released' && <button className="ev-button" onClick={() => setReceipt(detail.claim)}>View release receipt</button>}</div>
      {detail.claim.failed_attempts >= 5 && detail.claim.status === 'approved' && <p className="ev-help">Pickup code is locked. Ask the claimant to replace it in My claims. Staff cannot view or regenerate their code.</p>}
      {action && <div className="ev-form-grid"><p className="ev-wide ev-help">{action === 'approve' ? 'Approve only after comparing evidence and receiving the physical item. Another manager must review a manager’s own claim. The server privately issues a pickup code to the claimant.' : action === 'reject' ? 'The decision reason is shared with this claimant. Do not include another person’s evidence or private notes.' : 'Verify the claimant in person, check the private pickup code, and hand over the received item. Five incorrect codes lock pickup until the claimant replaces the code.'}</p>{action === 'release' && <><label>Pickup code<input autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.toUpperCase().replace(/[ -]/g, ''))} placeholder="6 characters" /></label><label className="ev-check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /><span>I checked the claimant’s identity in person and am physically handing over the item.</span></label></>}<label className="ev-wide">{action === 'release' ? 'Private release audit note' : 'Decision reason · shared with claimant'}<input maxLength={1000} minLength={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Record what you checked" /></label></div>}
      <details className="ev-history"><summary>Claim history ({detail.history.length})</summary><ol>{detail.history.map((entry) => <li key={entry.history_id}><strong>{entry.action}</strong><time>{manila(entry.created_at)}</time><p>{entry.note}</p></li>)}</ol></details>{receipt && <EventReceiptDialog claim={receipt} onClose={() => setReceipt(null)} />}
    </div>}
  </Modal>;
}

export default function EventClaimsPanel({ desk, reportId, onClearFilter }: { desk: DeskInfo; reportId?: string; onClearFilter: () => void }) {
  const [rows, setRows] = useState<EventClaim[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setRows([]); setError(''); staffClaims(desk.event.event_id, offset, reportId, controller.signal).then((data) => { if (!controller.signal.aborted) setRows(data.claims); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Claims unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [desk.event.event_id, offset, reportId, revision]);
  return <section className="ev-staff-claims"><header className="ev-claims-heading"><div><h3>{reportId ? 'Claims for the selected item' : 'Event ownership claims'}</h3><p>Managers review ownership; assigned desk staff complete verified handover.</p></div><div>{reportId && <button className="ev-button" onClick={() => { setOffset(0); onClearFilter(); }}>All event claims</button>}<button className="ev-button" disabled={loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15} />Refresh claims</button></div></header>{error && <p className="ev-alert" role="alert">{error}</p>}{loading ? <p className="ev-empty" role="status">Loading claims…</p> : !error && !rows.length ? <div className="ev-empty"><ClipboardCheck size={30} /><h3>No claims on this page</h3><p>Private ownership requests will appear here.</p></div> : <div className="ev-queue-list">{rows.map((claim) => <button key={claim.claim_id} onClick={() => setSelected(claim.claim_id)}><span className="ev-queue-main"><strong>{claim.item_label}</strong><small>{claim.reference} · {claim.claimant_name}</small></span><span className="ev-queue-state"><strong>{claim.status}</strong><small>{manila(claim.created_at)}</small></span></button>)}</div>}<div className="ev-pagination"><button className="ev-button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 24))}>Previous</button><button className="ev-button" disabled={loading || rows.length < 24} onClick={() => setOffset((value) => value + 24)}>Next</button></div>{selected && <ClaimDialog desk={desk} claimId={selected} onClose={() => setSelected(null)} onChanged={() => setRevision((value) => value + 1)} />}</section>;
}
