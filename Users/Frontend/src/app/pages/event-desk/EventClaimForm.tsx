import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import Modal from '@/app/shared/modal/Modal';
import { createClaim } from './recoveryApi';
import type { BoardReport } from './eventApi';

export default function EventClaimForm({ slug, item, onClose, onSaved }: { slug: string; item: BoardReport; onClose: () => void; onSaved: () => void }) {
  const requestId = useRef(crypto.randomUUID());
  const [evidence, setEvidence] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  useEffect(() => { if (!busy && !evidence && !proof) return; const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [busy, evidence, proof]);
  const close = () => { if (!busy && (reference || !evidence && !proof || window.confirm('Discard this unfinished ownership claim?'))) onClose(); };
  const save = async () => {
    setBusy(true); setError('');
    try { const result = await createClaim(slug, { report_id: item.report_id, request_id: requestId.current, evidence: evidence.trim() }, proof); setReference(result.claim.reference); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to submit your ownership claim.'); }
    finally { setBusy(false); }
  };
  return <Modal open onClose={close} dismissible={!busy} title={reference ? 'Claim submitted' : 'This might be mine'} eyebrow={item.reference + ' / ' + item.public_label} description="Only you and assigned event staff can see your ownership evidence." icon={<ShieldCheck size={23} />} tone="gold" size="md" footer={reference ? <button className="ev-button ev-button-primary" onClick={() => { onSaved(); onClose(); }}>View my claims</button> : <><button className="ev-button" disabled={busy} onClick={close}>Cancel</button><button className="ev-button ev-button-primary" disabled={busy || !ack || evidence.trim().length < 20 || /[<>\x00-\x1f]/.test(evidence)} onClick={() => void save()}>{busy ? 'Submitting…' : 'Submit ownership claim'}</button></>}>
    <div className="ev-dialog-content">{error && <p className="ev-alert" role="alert">{error}</p>}{reference ? <div className="ev-success"><ShieldCheck size={36} /><h3>{reference}</h3><p>A manager will compare your evidence with the private item details. Approval and physical desk receipt are required before pickup. Keep your pickup code private if your claim is approved.</p></div> : <div className="ev-form-grid"><label className="ev-wide">Private ownership evidence<textarea rows={4} maxLength={2000} minLength={20} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Describe unique marks, contents, purchase details or other features that only the owner would know. Use one paragraph without line breaks." /></label><label className="ev-wide">Supporting photo · optional<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0] || null; if (file && (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError('Choose a JPG, PNG or WebP image up to 5 MB.'); e.target.value = ''; setProof(null); } else { setProof(file); setError(''); } }} /><small>A receipt or earlier photo of the item can help. Cover unrelated personal details; this proof stays private.</small></label><label className="ev-wide ev-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>I am requesting ownership of this item and confirm that my evidence is accurate. Approval does not replace the in-person pickup identity check.</span></label></div>}</div>
  </Modal>;
}
