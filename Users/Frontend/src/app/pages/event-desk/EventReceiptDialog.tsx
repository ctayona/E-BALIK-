import { useEffect, useState } from 'react';
import { Copy, Printer, ShieldCheck } from 'lucide-react';
import Modal from '@/app/shared/modal/Modal';
import { manila } from './eventApi';
import { claimReceipt, type EventClaim, type EventReceipt } from './recoveryApi';

export default function EventReceiptDialog({ claim, onClose }: { claim: EventClaim; onClose: () => void }) {
  const [receipt, setReceipt] = useState<EventReceipt | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { const controller = new AbortController(); claimReceipt(claim.event_id, claim.claim_id, controller.signal).then((data) => { if (!controller.signal.aborted) setReceipt(data.receipt); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Receipt unavailable.'); }); return () => controller.abort(); }, [claim.event_id, claim.claim_id]);
  const link = receipt ? window.location.origin + '/event-receipts/' + receipt.claim_id + '?code=' + receipt.verification_code : '';
  return <Modal open onClose={onClose} title="Event handover receipt" eyebrow="E-BALIK / VERIFIED RELEASE" icon={<ShieldCheck size={24} />} tone="mint" size="md" footer={<><button className="ev-button" onClick={onClose}>Close</button>{receipt && <><button className="ev-button" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setError('Unable to copy. Select the verification link below.'))}><Copy size={15} />{copied ? 'Copied' : 'Copy verification link'}</button><button className="ev-button ev-button-primary" onClick={() => window.print()}><Printer size={15} />Print</button></>}</>}>
    {error && <p className="ev-alert" role="alert">{error}</p>}{!receipt ? <p role="status">Loading released-item receipt…</p> : <article className="ev-release-receipt"><span className="ev-eyebrow">RELEASE COMPLETED</span><h3>{receipt.event_name}</h3><dl><div><dt>Item</dt><dd>{receipt.item_label}</dd></div><div><dt>Released to</dt><dd>{receipt.released_to}</dd></div><div><dt>Released at · Manila</dt><dd>{manila(receipt.released_at)}</dd></div><div><dt>Receipt number</dt><dd>{receipt.receipt_no}</dd></div><div><dt>Verification code</dt><dd>{receipt.verification_code}</dd></div></dl><p>Keep this receipt as confirmation that the item was handed over at the event collection desk.</p><a href={link} target="_blank" rel="noreferrer">{link}</a></article>}
  </Modal>;
}
