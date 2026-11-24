import EventTagItems from './EventTagItems';
import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, CheckCircle2, Inbox, MapPin, Package, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import Modal from '@/app/shared/modal/Modal';
import { EventApiError, manila, myEventReports, portalBoard, portalInfo, reportAction, useEventSession, type BoardReport, type EventReport, type PortalInfo } from './eventApi';
import EventReportForm from './EventReportForm';
import EventClaimForm from './EventClaimForm';
import EventMyClaims from './EventMyClaims';
import EventAlertsPanel from './EventAlertsPanel';
import { eventAlertCount } from './alertsApi';
import { hubListing, recoveryInfo } from './pilotApi';
import EventHubConsent from './EventHubConsent';
import './eventPages.css';
import './eventPilot.css';

function ink(hex: string) {
  const luminance = (rgb: number[]) => rgb.map((v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, v, index) => sum + v * [.2126, .7152, .0722][index], 0);
  const color = luminance(hex.slice(1).match(/.{2}/g)?.map((v) => parseInt(v, 16)) || [255, 255, 255]);
  return 1.05 / (color + .05) >= (color + .05) / (luminance([20, 34, 61]) + .05) ? '#ffffff' : '#14223d';
}
export default function EventPortal({ slug }: { slug: string }) {
  const token = useEventSession();
  const [portal, setPortal] = useState<PortalInfo | null>(null);
  const [portalLoading, setPortalLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [tab, setTab] = useState<'board' | 'mine' | 'claims' | 'alerts'>('board');
  const [alertRevision, setAlertRevision] = useState(0);
  const [alertCount, setAlertCount] = useState(0);
  const [alertsAvailable, setAlertsAvailable] = useState(false);
  const [board, setBoard] = useState<BoardReport[]>([]);
  const [mine, setMine] = useState<EventReport[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [portalRevision, setPortalRevision] = useState(0);
  const [form, setForm] = useState<'missing' | 'found' | null>(null);
  const [withdraw, setWithdraw] = useState<EventReport | null>(null);
  const [claimItem, setClaimItem] = useState<BoardReport | null>(null);
  const [consentReport, setConsentReport] = useState<EventReport | null>(null);
  const [pilotAvailable, setPilotAvailable] = useState(false);
  const [finalInstructions, setFinalInstructions] = useState('');
  const [hubEntry, setHubEntry] = useState<{ listing: BoardReport; can_claim: boolean } | null>(null);
  const publication = new URLSearchParams(window.location.search).get('publication');
  const [withdrawing, setWithdrawing] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setPortal(null); setError(''); setCode(''); setPortalLoading(true);
    portalInfo(slug, controller.signal).then((value) => { if (!controller.signal.aborted) setPortal(value); }).catch((e) => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : 'Event page unavailable.'); setCode(e instanceof EventApiError ? e.code : 'request_failed'); } }).finally(() => { if (!controller.signal.aborted) setPortalLoading(false); });
    return () => controller.abort();
  }, [slug, portalRevision]);
  useEffect(() => {
    const controller = new AbortController(); setBoard([]); setMine([]); setLoading(tab !== 'claims' && tab !== 'alerts');
    if (!token) { setLoading(false); return () => controller.abort(); }
    const request = tab === 'claims' || tab === 'alerts' ? Promise.resolve() : tab === 'mine' ? myEventReports(slug, offset, controller.signal).then((data) => { if (!controller.signal.aborted) setMine(data.reports); }) : portal ? portalBoard(slug, offset, controller.signal).then((data) => { if (!controller.signal.aborted) setBoard(data.reports); }) : Promise.resolve();
    request.catch((e) => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : 'Unable to load event reports.'); setCode(e instanceof EventApiError ? e.code : 'request_failed'); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, token, portal, tab, offset, revision]);
  // Recheck event availability and refresh expiring artwork links without closing an unfinished report.
  useEffect(() => {
    if (!portal || form || withdraw || claimItem || consentReport || hubEntry) return;
    const refresh = () => { if (!document.hidden) setPortalRevision((v) => v + 1); };
    const timer = window.setInterval(refresh, 60000); window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [portal, form, withdraw, claimItem, consentReport, hubEntry]);
  useEffect(() => { const controller = new AbortController(); if (!token) { setAlertCount(0); setAlertsAvailable(false); return () => controller.abort(); } eventAlertCount(slug, controller.signal).then((value) => { if (!controller.signal.aborted) { setAlertCount(value.unread_count); setAlertsAvailable(value.available); } }).catch(() => { if (!controller.signal.aborted) setAlertCount(0); }); return () => controller.abort(); }, [slug, token, portalRevision, alertRevision, revision]);
  useEffect(() => { const controller = new AbortController(); if (!token) { setPilotAvailable(false); setFinalInstructions(''); return () => controller.abort(); } recoveryInfo(slug, controller.signal).then((value) => { if (!controller.signal.aborted) { setPilotAvailable(value.available); setFinalInstructions(value.instructions || ''); } }).catch(() => { if (!controller.signal.aborted) { setPilotAvailable(false); setFinalInstructions(''); } }); return () => controller.abort(); }, [slug, token, portalRevision]);
  useEffect(() => { const controller = new AbortController(); setHubEntry(null); if (publication && token) hubListing(publication, controller.signal).then((value) => { if (!controller.signal.aborted) { if (value.slug !== slug) throw new Error('This listing belongs to another event.'); setHubEntry(value); } }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'This hub listing is no longer available.'); }); return () => controller.abort(); }, [slug, token, publication]);
  const palette = portal?.event.branding;
  const style = palette ? { '--event-primary': palette.primary, '--event-accent': palette.accent, '--event-bg': palette.background, '--event-ink': ink(palette.background), '--event-on-primary': ink(palette.primary), '--event-on-accent': ink(palette.accent) } as CSSProperties : undefined;
  const switchTab = (next: 'board' | 'mine' | 'claims' | 'alerts') => { setTab(next); setOffset(0); setError(''); setCode(''); setRevision((v) => v + 1); };
  const withdrawReport = async () => {
    if (!withdraw) return; setWithdrawing(true); setError('');
    try { await reportAction(withdraw.event_id, withdraw, 'withdraw', {}); setWithdraw(null); setMessage('Your report was withdrawn from the event.'); setRevision((v) => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to withdraw report.'); }
    finally { setWithdrawing(false); }
  };
  return <main className={'event-portal event-template-' + (palette?.template || 'classic')} style={style}>
    <nav className="ev-portal-nav"><a href="/"><Package size={21} /><strong>E-Balik</strong><span>/ Event recovery</span></a><div>{token && <a href="/event-desk">Staff desk<ArrowUpRight size={14} /></a>}<a href="/">{token ? 'My E-Balik' : 'Sign in'}<ArrowUpRight size={14} /></a></div></nav>
    {portal ? <>
      <section className="ev-hero">{portal.artwork.banner?.url && <img className="ev-hero-cover" src={portal.artwork.banner.url} alt="" />}<div className="ev-hero-shade" /><div className="ev-hero-content"><span className="ev-eyebrow">UNIVERSITY OF MAKATI · EVENT RECOVERY</span><div className="ev-hero-identity">{portal.artwork.logo?.url && <img src={portal.artwork.logo.url} alt="Event logo" />}<div><p className="ev-hero-kicker">A place for things to find their way home.</p><h1>{portal.event.name}</h1></div></div><p className="ev-hero-description">Lost something? Found something?<br />Your event’s recovery desk is here to help.</p><div className="ev-hero-meta"><span><MapPin size={16} />{portal.event.venue}</span><span><CalendarDays size={16} />{manila(portal.event.starts_at)} · Manila</span></div><p className="ev-host">Hosted by {portal.event.organizer_name}</p></div><div className="ev-hero-ornament" /></section>
      <div className="ev-portal-body"><section className="ev-report-choices"><button disabled={!token} onClick={() => setForm('missing')}><Search size={24} /><span><strong>I lost an item</strong><small>Tell the event desk what is missing</small></span><ArrowUpRight size={18} /></button><button disabled={!token} onClick={() => setForm('found')}><Package size={24} /><span><strong>I found an item</strong><small>Help it reach the right person</small></span><ArrowUpRight size={18} /></button></section>
        {!token && <p className="ev-sign-in">Sign in to your existing E-Balik account to browse or submit reports, then return to this event link. Account verification is required.<a href="/">Open sign in<ArrowUpRight size={15} /></a></p>}
        <div className="ev-board-heading"><div><span className="ev-section-label">LOST & FOUND</span><h2>Your event. One recovery hub.</h2></div><span className="ev-status-pill">{portal.event.status === 'recovery' ? 'Recovery period' : 'Event open'}</span></div>
      </div>
    </> : portalLoading ? <div className="ev-portal-body ev-portal-unavailable" role="status">Opening your event recovery page?</div> : <div className="ev-portal-body ev-portal-unavailable"><ShieldCheck size={32} /><h1>Event recovery</h1><p>This event page may be paused or closed. If you have already submitted a report, sign in and open My reports below.</p><a href="/" className="ev-button"><ArrowLeft size={15} />Back to E-Balik</a></div>}
    <div className="ev-portal-body ev-board-section">
      {token && <EventTagItems scope="mine" event={portal?.event.event_id || 'slug:'+slug} title="My checked-in items"/>}
      <div className="ev-board-tabs"><div role="tablist" aria-label="Event reports"><button role="tab" aria-selected={tab === 'board'} aria-controls="ev-event-board" onClick={() => switchTab('board')}>Event board</button><button role="tab" aria-selected={tab === 'mine'} aria-controls="ev-own-reports" onClick={() => switchTab('mine')}>My reports</button><button role="tab" aria-selected={tab === 'claims'} aria-controls="ev-own-claims" onClick={() => switchTab('claims')}>My claims</button>{alertsAvailable && <button role="tab" aria-selected={tab === 'alerts'} aria-controls="ev-own-alerts" onClick={() => switchTab('alerts')}>Alerts{alertCount > 0 && <span className="ev-alert-count" aria-label={alertCount + ' unread event alerts'}>{alertCount > 99 ? '99+' : alertCount}</span>}</button>}</div><button className="ev-button" aria-label="Refresh event reports" disabled={loading} onClick={() => { setError(''); setCode(''); setRevision((v) => v + 1); setPortalRevision((v) => v + 1); }}><RefreshCw size={16} /></button></div>
      {error && <div role="alert" className="ev-alert">{error}{code === 'verification_required' && <a href="/?open=profile">Open Profile & verification</a>}</div>}{message && <p role="status" className="ev-notice">{message}</p>}
      {token && (loading ? <p className="ev-empty" role="status">Loading event reports…</p> : tab === 'alerts' ? <section id="ev-own-alerts" role="tabpanel"><EventAlertsPanel slug={slug} onChanged={() => setAlertRevision((value) => value + 1)} onClaim={setClaimItem} onClaims={() => switchTab('claims')} /></section> : tab === 'claims' ? <section id="ev-own-claims" role="tabpanel"><EventMyClaims slug={slug} /></section> : tab === 'board' ? <section id="ev-event-board" role="tabpanel">{!board.length ? <div className="ev-empty"><Inbox size={32} /><h3>No approved items on this page yet</h3><p>Reports appear after review by an event manager.</p></div> : <div className="ev-board-grid">{board.map((item) => <article key={item.report_id} className="ev-board-card"><div className="ev-board-card-icon">{item.kind === 'found' ? <Package size={29} /> : <Search size={29} />}</div><div><span className="ev-card-kind">{item.kind === 'found' ? 'Found' : 'Missing'} · {item.category}</span><h3>{item.public_label}</h3><p><MapPin size={14} />{item.venue}</p><small>{manila(item.occurred_at)} · Manila</small><p className="ev-reference">{item.reference}</p><p className="ev-board-help">{item.received_at ? 'Received at the event collection desk.' : 'A report has been submitted; physical receipt is not confirmed.'} Ask the event desk about this reference.</p>{portal?.claims_available && item.kind === 'found' && <button className="ev-button ev-claim-item" onClick={() => setClaimItem(item)}>This might be mine</button>}</div></article>)}</div>}</section> : <section id="ev-own-reports" role="tabpanel">{!mine.length ? <div className="ev-empty"><Inbox size={32} /><h3>No reports on this page</h3><p>Your event reports and their current review status will appear here.</p></div> : <div className="ev-own-list">{mine.map((item) => <article key={item.report_id}><div><span className="ev-card-kind">{item.reference} · {item.kind}</span><h3>{item.item_name}</h3><p>{item.venue} · {manila(item.occurred_at)}</p><p>{item.withdrawn_at ? 'Withdrawn' : item.released_at ? 'Released through verified event handover' : item.received_at ? 'Received by the event desk' : item.moderation_status === 'approved' ? 'Approved for the event board' : item.moderation_status === 'hidden' ? 'Kept private by the event manager' : 'Awaiting manager review'}</p></div><div className="ev-pilot-tools">{pilotAvailable && <button className="ev-button" onClick={() => setConsentReport(item)}>Hub permission</button>}{!item.withdrawn_at && !item.received_at && <button className="ev-button" onClick={() => setWithdraw(item)}>Withdraw</button>}</div></article>)}</div>}</section>)}
      {token && tab !== 'claims' && tab !== 'alerts' && <div className="ev-pagination"><button className="ev-button" disabled={loading || offset === 0} onClick={() => setOffset((v) => Math.max(0, v - 24))}>Previous</button><span>Page {offset / 24 + 1}</span><button className="ev-button" disabled={loading || (tab === 'board' ? board.length : mine.length) < 24} onClick={() => setOffset((v) => v + 24)}>Next</button></div>}
      {portal && <aside className="ev-collection"><MapPin size={24} /><div><h3>Visit the collection desk</h3><p>{portal.event.desk_instructions}</p><small>Final claiming date: {manila(portal.event.recovery_ends_at)} · Manila</small></div></aside>}
      {finalInstructions && <aside className="ev-collection"><MapPin size={24} /><div><h3>Final recovery arrangements</h3><p>{finalInstructions}</p></div></aside>}
      <footer className="ev-portal-footer"><ShieldCheck size={14} />Event reports stay in this event. Private descriptions and photos are never shown on this board.</footer>
    </div>
    {consentReport && <EventHubConsent report={consentReport} onClose={() => setConsentReport(null)} />}
    {hubEntry && <Modal open title="Event listing from the hub" eyebrow={hubEntry.listing.reference} onClose={() => setHubEntry(null)} footer={<><button className="ev-button" onClick={() => setHubEntry(null)}>Close listing</button>{hubEntry.can_claim && <button className="ev-button ev-button-primary" onClick={() => { setClaimItem(hubEntry.listing); setHubEntry(null); }}>This might be mine</button>}{hubEntry.listing.kind === 'missing' && portal && <button className="ev-button ev-button-primary" onClick={() => { setForm('found'); setHubEntry(null); }}>I found this item</button>}</>}><div className="ev-dialog-content"><h3>{hubEntry.listing.public_label}</h3><p>{hubEntry.listing.category} · {hubEntry.listing.venue}</p><p>{manila(hubEntry.listing.occurred_at)} · Manila</p><p className="ev-help">This is an approved generic event listing. Evidence, claims, pickup and physical custody stay with this event. Contact the event desk for assistance.</p></div></Modal>}
    {form && portal && <EventReportForm event={portal.event} slug={slug} categories={portal.categories} venues={portal.venues} kind={form} onClose={() => setForm(null)} onSaved={() => { switchTab('mine'); setMessage('Your event report was submitted for review.'); }} />}
    {claimItem && <EventClaimForm slug={slug} item={claimItem} onClose={() => setClaimItem(null)} onSaved={() => { switchTab('claims'); setMessage('Ownership claim submitted for manager review.'); }} />}
    {withdraw && <Modal open onClose={() => setWithdraw(null)} dismissible={!withdrawing} title="Withdraw this event report?" description="This removes it from the event board and keeps its audit history. Reports already received into desk custody cannot be withdrawn." tone="danger" icon={<CheckCircle2 size={22} />} footer={<><button className="ev-button" disabled={withdrawing} onClick={() => setWithdraw(null)}>Keep report</button><button className="ev-button ev-button-primary" disabled={withdrawing} onClick={() => void withdrawReport()}>{withdrawing ? 'Withdrawing…' : 'Withdraw report'}</button></>}>{error && <p role="alert" className="ev-alert">{error}</p>}<p>{withdraw.reference} · {withdraw.item_name}</p></Modal>}
  </main>;
}
