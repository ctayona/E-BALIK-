import { useEffect, useState } from 'react';
import { Bell, BellRing, RefreshCw } from 'lucide-react';
import Modal from '@/app/shared/modal/Modal';
import { manila, type BoardReport } from './eventApi';
import { eventAlertAction, myEventAlerts, type EventAlert } from './alertsApi';
import './eventAlerts.css';

export default function EventAlertsPanel({ slug, onChanged, onClaim, onClaims }: { slug: string; onChanged: () => void; onClaim: (listing: BoardReport) => void; onClaims: () => void }) {
  const [rows, setRows] = useState<EventAlert[]>([]);
  const [view, setView] = useState<'inbox' | 'all'>('inbox');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<EventAlert | null>(null);
  const [dismiss, setDismiss] = useState<EventAlert | null>(null);
  useEffect(() => { setSelected(null); setDismiss(null); setOffset(0); }, [slug]);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setRows([]); setError(''); myEventAlerts(slug, offset, view, controller.signal).then((value) => { if (!controller.signal.aborted) setRows(value.alerts); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load your event alerts.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [slug, offset, view, revision]);
  const open = async (alert: EventAlert) => {
    setBusy(true); setError('');
    try { const value = await eventAlertAction(alert, 'read'); setSelected(value.alert); setRows((old) => old.map((row) => row.alert_id === alert.alert_id ? value.alert : row)); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to open this alert.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!dismiss) return; setBusy(true); setError('');
    try { await eventAlertAction(dismiss, 'dismiss'); setDismiss(null); setSelected(null); setRevision((value) => value + 1); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to dismiss this alert.'); }
    finally { setBusy(false); }
  };
  return <section className="ev-event-alerts"><header className="ev-claims-heading"><div><span className="ev-eyebrow">PRIVATE EVENT INBOX</span><h3>Your event alerts</h3><p>Manager-reviewed leads for your missing reports. Ownership still requires verification.</p></div><button className="ev-button" disabled={loading || busy} onClick={() => { setRevision((value) => value + 1); onChanged(); }}><RefreshCw size={15} />Refresh alerts</button></header><nav className="ev-alert-filters" aria-label="Event alert views">{(['inbox','all'] as const).map((value) => <button key={value} className="ev-button" aria-pressed={view === value} disabled={busy} onClick={() => { setView(value); setOffset(0); }}>{value === 'inbox' ? 'Inbox' : 'All alerts'}</button>)}</nav>
    {error && !dismiss && <p className="ev-alert" role="alert">{error}</p>}{loading ? <p className="ev-empty" role="status">Loading your event alerts…</p> : !error && !rows.length ? <div className="ev-empty"><Bell size={30} /><h3>No alerts on this page</h3><p>A manager can notify you after reviewing a possible match for your event report.</p></div> : <div className="ev-event-alert-list">{rows.map((alert) => <article key={alert.alert_id} className={!alert.read_at && alert.status === 'active' ? 'ev-event-alert-new' : ''}><div className="ev-event-alert-icon"><BellRing size={22} /></div><div><div className="ev-report-badges"><span>{alert.status === 'inactive' ? 'Inactive' : alert.dismissed_at ? 'Dismissed' : alert.read_at ? 'Read' : 'New'}</span><span>{alert.missing_reference}</span></div><h4>{alert.title}</h4><p>{alert.missing_label}</p><small>{manila(alert.created_at)} · Manila</small><div className="ev-alert-row-actions"><button className="ev-button ev-button-primary" disabled={busy} onClick={() => void open(alert)}>Review alert</button>{!alert.dismissed_at && <button className="ev-button" disabled={busy} onClick={() => { setError(''); setDismiss(alert); }}>Dismiss</button>}</div></div></article>)}</div>}
    <div className="ev-pagination"><button className="ev-button" disabled={loading || busy || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 24))}>Previous</button><span>Page {offset / 24 + 1}</span><button className="ev-button" disabled={loading || busy || rows.length < 24} onClick={() => setOffset((value) => value + 24)}>Next</button></div>
    {selected && <Modal open title="Your event match alert" eyebrow={selected.missing_reference} icon={<BellRing size={23} />} tone="gold" onClose={() => setSelected(null)} footer={<><button className="ev-button" onClick={() => setSelected(null)}>Close</button>{selected.claim_status && <button className="ev-button ev-button-primary" onClick={onClaims}>Open My claims</button>}{selected.can_claim && selected.listing && <button className="ev-button ev-button-primary" onClick={() => { if (selected.listing) { onClaim(selected.listing); setSelected(null); } }}>This might be mine</button>}</>}><div className="ev-alert-preview"><h3>{selected.title}</h3><p>{selected.message}</p>{selected.listing ? <div className="ev-alert-listing"><span>{selected.listing.reference} · APPROVED EVENT LISTING</span><h4>{selected.listing.public_label}</h4><p>{selected.listing.category} · {selected.listing.venue}</p><p>{manila(selected.listing.occurred_at)} · Manila</p><p>{selected.listing.received_at ? 'Received at the event collection desk.' : 'Physical desk receipt is not confirmed yet.'}</p></div> : <p className="ev-help">{selected.availability_note}</p>}{selected.claim_status && <p className="ev-help">Your ownership request is {selected.claim_status}. Track its decision and pickup steps in My claims.</p>}<p className="ev-help">If you recover the missing item, withdraw its missing report in My reports to stop further match alerts.</p></div></Modal>}
    {dismiss && <Modal open title="Dismiss this event alert?" description="Move it out of your inbox. You can still find it in All alerts; this does not withdraw your report or ownership claim." tone="gold" dismissible={!busy} onClose={() => setDismiss(null)} footer={<><button className="ev-button" disabled={busy} onClick={() => setDismiss(null)}>Keep alert</button><button className="ev-button ev-button-primary" disabled={busy} onClick={() => void remove()}>{busy ? 'Saving…' : 'Dismiss alert'}</button></>}>{error && <p className="ev-alert" role="alert">{error}</p>}<p>{dismiss.missing_reference} · {dismiss.missing_label}</p></Modal>}
  </section>;
}
