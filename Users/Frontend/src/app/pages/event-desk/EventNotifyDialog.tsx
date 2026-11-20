import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import Modal from '@/app/shared/modal/Modal';
import { manila } from './eventApi';
import type { MatchReport } from './matchingApi';
import { previewEventAlert, sendEventAlert, type EventAlertPreview } from './alertsApi';
import './eventAlerts.css';

export default function EventNotifyDialog({ eventId, missing, found, onClose, onSent }: { eventId: string; missing: MatchReport; found: MatchReport; onClose: () => void; onSent: (replayed: boolean) => void }) {
  const [preview, setPreview] = useState<EventAlertPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); setPreview(null); setLoading(true); setError(''); previewEventAlert(eventId, missing, found, controller.signal).then((data) => { if (!controller.signal.aborted) setPreview(data.preview); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to prepare the alert.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [eventId, missing.report_id, missing.version, found.report_id, found.version]);
  const send = async () => {
    if (!preview) return; setBusy(true); setError('');
    try { const value = await sendEventAlert(eventId, preview); onSent(value.already_sent); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to send this event alert.'); }
    finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} dismissible={!busy} title="Notify the report owner" eyebrow="EVENT MATCH ALERT" description="Review the exact generic notice and approved listing before sending." icon={<BellRing size={24} />} tone="gold" footer={<><button className="ev-button" disabled={busy} onClick={onClose}>Close and refresh</button><button className="ev-button ev-button-primary" disabled={busy || loading || !preview || preview.already_sent} onClick={() => void send()}>{busy ? 'Sending…' : preview?.already_sent ? 'Already notified' : 'Send event alert'}</button></>}>
    {error && <p role="alert" className="ev-alert">{error}</p>}{loading ? <p role="status">Preparing a private event notice…</p> : preview && <div className="ev-alert-preview"><p className="ev-help">For the owner of {preview.missing_reference} · {preview.event_name}</p><div className="ev-alert-message"><span>NOTICE PREVIEW</span><h3>{preview.title}</h3><p>{preview.message}</p></div><div className="ev-alert-listing"><span>{preview.listing.reference} · Approved event listing</span><h3>{preview.listing.public_label}</h3><p>{preview.listing.category} · {preview.listing.venue}</p><p>{manila(preview.listing.occurred_at)} · Manila</p></div><p className="ev-help">The notice stays in this event’s inbox. Ownership still requires private evidence, manager approval and verified handover. Private descriptions, photos and comparison reasons are excluded.</p></div>}
  </Modal>;
}
