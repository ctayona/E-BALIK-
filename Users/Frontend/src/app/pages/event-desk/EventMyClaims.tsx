import { useEffect, useState } from 'react';
import { Eye, RefreshCw, ShieldCheck } from 'lucide-react';
import Modal from '@/app/shared/modal/Modal';
import { claimAction, myClaims, type EventClaim } from './recoveryApi';
import { manila } from './eventApi';
import EventReceiptDialog from './EventReceiptDialog';

export default function EventMyClaims({ slug }: { slug: string }) {
  const [rows, setRows] = useState<EventClaim[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [code, setCode] = useState<EventClaim | null>(null);
  const [action, setAction] = useState<{ claim: EventClaim; kind: 'withdraw' | 'reset_pin' } | null>(null);
  const [receipt, setReceipt] = useState<EventClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!code) return; setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [code]);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setRows([]); setError(''); myClaims(slug, offset, controller.signal).then((data) => { if (!controller.signal.aborted) setRows(data.claims); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load your event claims.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [slug, offset, revision]);
  const save = async () => {
    if (!action) return; setBusy(true); setError('');
    try { await claimAction(action.claim, action.kind, {}); setAction(null); setCode(null); setRevision((value) => value + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to update your claim.'); }
    finally { setBusy(false); }
  };
  return <section className="ev-my-claims"><header className="ev-claims-heading"><div><h3>Your ownership requests</h3><p>Evidence and pickup codes stay private. Keep the code until you are at the collection desk.</p></div><button className="ev-button" disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15} />Refresh</button></header>{error && !action && <p role="alert" className="ev-alert">{error}</p>}{loading ? <p role="status" className="ev-empty">Loading your claims…</p> : !error && !rows.length ? <div className="ev-empty"><ShieldCheck size={30} /><h3>No ownership claims on this page</h3><p>Choose “This might be mine” on a found item to submit private evidence.</p></div> : <div className="ev-claims-list">{rows.map((claim) => <article key={claim.claim_id}><div><span className="ev-card-kind">{claim.reference} · {claim.status}</span><h3>{claim.item_label}</h3><p>Submitted {manila(claim.created_at)} · Manila</p>{claim.decision_note && <p>{claim.decision_note}</p>}</div><div className="ev-claim-row-actions">{claim.status === 'approved' && <button className="ev-button ev-button-primary" onClick={() => setCode(claim)}><Eye size={15} />Pickup code</button>}{['pending', 'approved'].includes(claim.status) && <button className="ev-button" onClick={() => setAction({ claim, kind: 'withdraw' })}>Withdraw claim</button>}{claim.status === 'released' && <button className="ev-button ev-button-primary" onClick={() => setReceipt(claim)}>View receipt</button>}</div></article>)}</div>}<div className="ev-pagination"><button className="ev-button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 24))}>Previous</button><span>Page {offset / 24 + 1}</span><button className="ev-button" disabled={loading || rows.length < 24} onClick={() => setOffset((value) => value + 24)}>Next</button></div>
    {code && <Modal open onClose={() => setCode(null)} title="Your private pickup code" eyebrow={code.reference} icon={<ShieldCheck size={24} />} tone="gold" footer={<><button className="ev-button" onClick={() => setCode(null)}>Close</button><button className="ev-button ev-button-primary" disabled={now - Date.parse(code.pin_issued_at || '') < 60000 || now >= Date.parse(code.pickup_expires_at || '')} onClick={() => { setAction({ claim: code, kind: 'reset_pin' }); }}>Replace code</button></>}><div className="ev-pickup-code"><p>{code.item_label}</p>{now >= Date.parse(code.pickup_expires_at || '') ? <p>This pickup approval has expired. Submit a new claim while event recovery is open.</p> : code.pickup_code ? <strong>{code.pickup_code}</strong> : <p>{code.pickup_locked ? 'This code is locked after repeated incorrect attempts. Replace it to continue.' : 'Code unavailable. Replace it or ask the event desk for assistance.'}</p>}<p>Valid until {code.pickup_expires_at ? manila(code.pickup_expires_at) : 'the recovery deadline'} · Manila</p><small>Show this code only at pickup. Staff must verify your identity and physically hand over the item. Replacing a code invalidates the previous one; replacements are limited to once per minute.</small></div></Modal>}
    {action && <Modal open onClose={() => setAction(null)} dismissible={!busy} title={action.kind === 'withdraw' ? 'Withdraw this ownership claim?' : 'Replace pickup code?'} description={action.kind === 'withdraw' ? 'This ends your current ownership request and invalidates its pickup code.' : 'Your old pickup code will stop working immediately. The original pickup deadline stays the same.'} tone="gold" footer={<><button className="ev-button" disabled={busy} onClick={() => setAction(null)}>Back</button><button className="ev-button ev-button-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Confirm'}</button></>}>{error && <p role="alert" className="ev-alert">{error}</p>}<p>{action.claim.reference} · {action.claim.item_label}</p></Modal>}
    {receipt && <EventReceiptDialog claim={receipt} onClose={() => setReceipt(null)} />}
  </section>;
}
