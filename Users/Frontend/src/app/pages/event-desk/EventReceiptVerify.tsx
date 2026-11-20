import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { verifyEventReceipt } from './recoveryApi';
import './eventPages.css';

export default function EventReceiptVerify({ claimId }: { claimId: string }) {
  const [data, setData] = useState<{ item_label: string; released_on: string; receipt_no: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const code = new URLSearchParams(window.location.search).get('code') || '';
  useEffect(() => { const controller = new AbortController(); verifyEventReceipt(claimId, code, controller.signal).then((value) => { if (!controller.signal.aborted) setData(value); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Receipt verification unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [claimId, code]);
  return <main className="ev-receipt-verify"><a href="/" className="ev-button">Back to E-Balik</a><section><ShieldCheck size={37} /><span className="ev-eyebrow">E-BALIK / EVENT HANDOVER</span><h1>{loading ? 'Verifying receipt…' : data ? 'Verified item release' : 'Receipt could not be verified'}</h1>{error && <p role="alert" className="ev-alert">{error}</p>}{data && <><h2>{data.item_label}</h2><p>Release date: {data.released_on}</p><code>{data.receipt_no}</code><p>This confirms a completed event handover record. Recipient identity and private ownership evidence are not shared by this verification page.</p></>}</section></main>;
}
