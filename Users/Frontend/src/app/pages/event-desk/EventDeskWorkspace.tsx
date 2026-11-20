import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Inbox, Plus, RefreshCw, Search } from 'lucide-react';
import { eventQueue, manila, type DeskInfo, type EventReport } from './eventApi';
import EventReportForm from './EventReportForm';
import EventReportDialog from './EventReportDialog';
import EventClaimsPanel from './EventClaimsPanel';
import EventMatchesPanel from './EventMatchesPanel';
import EventPilotSummary from './EventPilotSummary';
import EventOperatorGuide from './EventOperatorGuide';
import './eventPages.css';

export default function EventDeskWorkspace({ desk, onBack }: { desk: DeskInfo; onBack: () => void }) {
  const [rows, setRows] = useState<EventReport[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [panel, setPanel] = useState<'reports' | 'claims' | 'matches' | 'summary' | 'guide'>('reports');
  const [claimReport, setClaimReport] = useState<string | undefined>();
  const [matchReport, setMatchReport] = useState<string | undefined>();
  const [reportId, setReportId] = useState<string | null>(null);
  const [form, setForm] = useState<'missing' | 'found' | null>(null);
  useEffect(() => {
    if (!desk.reports_available) { setRows([]); setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError(''); setRows([]);
    eventQueue(desk.event.event_id, offset, controller.signal).then((data) => { if (!controller.signal.aborted) setRows(data.reports); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load event reports.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [desk.event.event_id, desk.reports_available, offset, revision]);
  const refresh = () => { setRevision((value) => value + 1); setMessage('Event report saved.'); };
  const visible = rows.filter((row) => (tab === 'all' || tab === 'pending' && row.moderation_status === 'pending' && !row.withdrawn_at || tab === 'received' && !!row.received_at && !row.released_at || tab === 'released' && !!row.released_at || tab === row.kind) && `${row.reference} ${row.item_name} ${row.category} ${row.venue}`.toLowerCase().includes(query.toLowerCase()));
  const writes = ['active', 'recovery'].includes(desk.event.status) && Date.now() < Date.parse(desk.event.recovery_ends_at);
  return <section className="ev-desk-workspace"><div className="ev-workspace-toolbar"><button className="ev-button" onClick={onBack}><ArrowLeft size={16} />Your assignments</button><div><button className="ev-button" aria-pressed={panel === 'guide'} onClick={() => setPanel(panel === 'guide' ? 'reports' : 'guide')}>Staff guide</button><button className="ev-button" disabled={loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={16} />Refresh reports</button>{desk.reporting_enabled && <a className="ev-button" href={desk.portal_url} target="_blank" rel="noreferrer"><ExternalLink size={16} />Attendee page</a>}</div></div>
    <div className="ev-workspace-title"><div><span className="ev-eyebrow">EVENT OPERATIONS / {desk.role === 'manager' ? 'MANAGER' : 'DESK STAFF'}</span><h2>{desk.event.name}</h2><p>{desk.event.venue} · {desk.event.status} · Access until {manila(desk.expires_at)} Manila</p></div>{desk.reports_available && writes && <div className="ev-intake-actions"><button className="ev-button" onClick={() => setForm('missing')}><Plus size={16} />Missing report</button><button className="ev-button ev-button-primary" onClick={() => setForm('found')}><Plus size={16} />Found report</button></div>}</div>
    {panel === 'guide' ? <EventOperatorGuide desk={desk} onNavigate={(next) => { setClaimReport(undefined); setMatchReport(undefined); setPanel(next); }} /> : !desk.reports_available ? <p className="ev-help">Report operations require the user-run event reports migration. Your assignment is active; reporting setup is not installed yet.</p> : <>
      {error && <p role="alert" className="ev-alert">{error}</p>}{message && <p role="status" className="ev-notice">{message}</p>}
      <nav className="ev-operation-tabs" aria-label="Event desk sections"><button aria-pressed={panel === 'reports'} onClick={() => setPanel('reports')}>Reports and intake</button><button aria-pressed={panel === 'matches'} onClick={() => setPanel('matches')}>Possible matches</button>{desk.claims_available && <button aria-pressed={panel === 'claims'} onClick={() => { setPanel('claims'); setClaimReport(undefined); }}>Ownership claims</button>}{desk.operations_available && desk.role === 'manager' && <button aria-pressed={panel === 'summary'} onClick={() => setPanel('summary')}>Recovery summary</button>}</nav>
      {panel === 'summary' && desk.role === 'manager' ? <EventPilotSummary eventId={desk.event.event_id} /> : panel === 'matches' ? <EventMatchesPanel desk={desk} sourceId={matchReport} onSelect={setMatchReport} onReview={setReportId} revision={revision} /> : panel === 'claims' && desk.claims_available ? <EventClaimsPanel key={claimReport || 'all'} desk={desk} reportId={claimReport} onClearFilter={() => setClaimReport(undefined)} /> : <>
      <div className="ev-queue-tools"><nav aria-label="Filter reports on this page">{[['all', 'All reports'], ['pending', 'Needs review'], ['found', 'Found'], ['missing', 'Missing'], ['received', 'In custody'], ['released', 'Released']].map(([value, label]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</nav><label className="ev-search"><Search size={17} /><input aria-label="Search reports on this page" placeholder="Search this page" value={query} onChange={(e) => setQuery(e.target.value)} /></label></div>
      <p className="ev-page-count">Page {Math.floor(offset / 24) + 1} · {rows.length} loaded reports · Filters apply to this page</p>
      {loading ? <p role="status" className="ev-empty">Loading event reports…</p> : !error && !visible.length ? <div className="ev-empty"><Inbox size={30} /><h3>{rows.length ? 'No reports match this filter' : 'Your recovery desk starts here'}</h3><p>{rows.length ? 'Try another filter or page.' : 'Attendee submissions and reports recorded at the desk will appear here.'}</p></div> : <div className="ev-queue-list">{visible.map((row) => <button key={row.report_id} onClick={() => setReportId(row.report_id)} className="ev-queue-row"><span className={'ev-kind-icon ev-kind-' + row.kind}>{row.kind === 'found' ? 'F' : 'M'}</span><span className="ev-queue-main"><strong>{row.item_name}</strong><small>{row.reference} · {row.category} · {row.venue}</small></span><span className="ev-queue-state"><strong>{row.released_at ? 'Released' : row.withdrawn_at ? 'Withdrawn' : row.moderation_status === 'pending' ? 'Needs review' : row.moderation_status}</strong><small>{row.released_at ? 'Returned to owner' : row.received_at ? 'In desk custody' : 'No desk receipt'}</small></span></button>)}</div>}
      <div className="ev-pagination"><button className="ev-button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 24))}>Previous</button><button className="ev-button" disabled={loading || rows.length < 24} onClick={() => setOffset((value) => value + 24)}>Next</button></div>
      </>}
      <p className="ev-help">Reports, ownership evidence and handover records stay in this event. Event assignments never grant campus administrator access.</p>
    </>}
    {reportId && <EventReportDialog desk={desk} reportId={reportId} onMatches={() => { setMatchReport(reportId); setPanel('matches'); setReportId(null); }} onClaims={() => { setClaimReport(reportId); setPanel('claims'); setReportId(null); }} onClose={() => setReportId(null)} onChanged={refresh} />}
    {form && <EventReportForm event={desk.event} categories={desk.categories} venues={desk.venues} kind={form} onClose={() => setForm(null)} onSaved={refresh} />}
  </section>;
}
