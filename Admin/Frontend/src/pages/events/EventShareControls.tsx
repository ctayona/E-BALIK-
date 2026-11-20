import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Copy, Download, ExternalLink, Printer, QrCode, RefreshCw } from 'lucide-react';
import AdminModal from '../../components/ui/AdminModal';
import { BTN } from '../../components/ui/primitives';
import { fetchEventShare, type EventDraft, type EventShareInfo } from './eventsApi';
import { printEventPoster } from './eventSharePrint';
import './eventSharePoster.css';

function ink(hex: string) {
  const values = hex.slice(1).match(/.{2}/g)?.map((value) => parseInt(value, 16) / 255) || [0, 0, 0];
  const luminance = values.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  return luminance > .179 ? '#101b30' : '#ffffff';
}
const manila = (value: string | null) => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'To be confirmed';

export default function EventShareControls({ event, disabled }: { event: EventDraft; disabled: boolean }) {
  const [info, setInfo] = useState<EventShareInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [revision, setRevision] = useState(0);
  const poster = useRef<HTMLElement | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setInfo(null); setError(''); setCopied(false);
    fetchEventShare(event.event_id, controller.signal).then((value) => { if (!controller.signal.aborted) setInfo(value); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Event sharing is unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [event.event_id, event.version, revision]);
  useEffect(() => () => pending.current?.abort(), []);
  const copy = async () => {
    if (!info) return;
    try { await navigator.clipboard.writeText(info.url); setCopied(true); }
    catch { setError('Unable to copy. Select and copy the displayed event link.'); }
  };
  const show = async () => {
    setOpen(true); setError(''); setBusy(true);
    const controller = new AbortController(); pending.current?.abort(); pending.current = controller;
    try { const value = await fetchEventShare(event.event_id, controller.signal); if (!controller.signal.aborted) setInfo(value); }
    catch (e) { if (!controller.signal.aborted) { setInfo(null); setError(e instanceof Error ? e.message : 'Event sharing is unavailable.'); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const exportPoster = async (kind: 'qr' | 'print') => {
    if (!info) return; setBusy(true); setError('');
    const controller = new AbortController(); pending.current?.abort(); pending.current = controller;
    try {
      const fresh = await fetchEventShare(event.event_id, controller.signal);
      if (controller.signal.aborted) return;
      setInfo(fresh);
      if (!fresh.share_ready) { setError(fresh.reason); return; }
      if (fresh.event.version !== info.event.version || fresh.url !== info.url) { setError('The saved event or its address changed. Review the updated poster, then try again.'); return; }
      if (kind === 'qr') {
        const link = document.createElement('a'); link.href = fresh.qr_image; link.download = fresh.event.slug + '-event-entry-qr.png';
        document.body.append(link); link.click(); link.remove();
      } else if (poster.current) await printEventPoster(poster.current);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to prepare this event poster.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const palette = info?.event.branding;
  const colors = palette ? { '--entry-primary': palette.primary, '--entry-accent': palette.accent, '--entry-background': palette.background, '--entry-on-primary': ink(palette.primary), '--entry-on-background': ink(palette.background) } as CSSProperties : undefined;
  const instructions = info?.event.desk_instructions || '';
  return <div className="event-entry-controls">
    {loading ? <p className="event-panel-note" role="status">Preparing the saved event link…</p> : info && <div className="event-portal-link"><code>{info.url}</code><button type="button" className={BTN.ghost} aria-label="Copy event page link" disabled={disabled || busy} onClick={() => void copy()}><Copy size={15} />{copied ? 'Copied' : 'Copy'}</button></div>}
    {error && !open && <p role="alert" className="event-review-error">{error}</p>}
    <div className="event-review-actions"><button type="button" className={BTN.ghost} disabled={disabled || busy || loading || !info} onClick={() => void show()}><QrCode size={16} />QR &amp; poster</button>{info && <a className={BTN.ghost} href={info.url} target="_blank" rel="noreferrer"><ExternalLink size={15} />Preview event page</a>}<button type="button" className={BTN.ghost} aria-label="Refresh event sharing" disabled={disabled || busy || loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15} /></button></div>
    {open && <AdminModal title="Share this event" description="An entry point to this event’s own lost-and-found page." icon={<QrCode size={24} />} size="xl" busy={busy} onClose={() => setOpen(false)} footer={<><button type="button" className={BTN.ghost} disabled={busy} onClick={() => setOpen(false)}>Close</button><button type="button" className={BTN.ghost} disabled={busy || !info?.share_ready} onClick={() => void exportPoster('qr')}><Download size={16} />Download QR</button><button type="button" className={BTN.primary} disabled={busy || !info?.share_ready} onClick={() => void exportPoster('print')}><Printer size={16} />Print poster / PDF</button></>}>
      {error && <p role="alert" className="event-review-error">{error}</p>}
      {busy && <p role="status" className="event-panel-note">Checking the latest event access…</p>}
      {info && <div className="event-entry-share-layout"><div><p className="event-entry-preview-label">SAVED EVENT · {info.share_ready ? 'READY TO SHARE' : 'PREVIEW ONLY'}</p><article ref={poster} className="event-entry-poster" style={colors} aria-label="Event entry poster">
        <header><span>UNIVERSITY OF MAKATI</span><p>E-BALIK / EVENT RECOVERY</p><h3>{info.event.name}</h3><small>Hosted by {info.event.organizer_name || 'Your event team'}</small></header>
        <div className="event-entry-poster-body"><span className="event-entry-poster-kicker">LOST SOMETHING? FOUND SOMETHING?</span><h4>Scan. Report. Reconnect.</h4><div className="event-entry-qr"><img src={info.qr_image} width={264} height={264} alt={'QR code opening the lost-and-found page for ' + info.event.name} /></div><p className="event-entry-poster-account">Sign in with your verified E-Balik account.</p><p className="event-entry-poster-url">{info.url}</p><div className="event-entry-poster-desk"><strong>{info.event.venue || 'Event collection desk'}</strong><p>{instructions.length > 240 ? instructions.slice(0, 237) + '… See the event page for full instructions.' : instructions || 'Check the event page for collection instructions.'}</p><span>FINAL CLAIMING · MANILA</span><p>{manila(info.event.recovery_ends_at)}</p></div></div><footer>One event. One place for things to find their way home.</footer>
      </article></div><aside className="event-entry-share-notes"><span className="event-studio-eyebrow">YOUR EVENT, CONNECTED</span><h3>A clear way to find the desk.</h3><p>Display the poster at entrances, registration tables and the collection desk. Share the QR image in event announcements.</p><ol><li><strong>Scan the event code</strong><span>Opens this event’s recovery page.</span></li><li><strong>Sign in to E-Balik</strong><span>Use an existing verified account.</span></li><li><strong>Report or request ownership</strong><span>Reports and recovery stay within this event.</span></li></ol>{!info.share_ready && <p className="event-panel-note" role="status">{info.reason}</p>}<p className="event-entry-share-footnote">The code keeps the same event link. Pausing or closing the event also closes attendee access through printed codes.</p><button type="button" className={BTN.ghost} disabled={busy} onClick={() => void copy()}><Copy size={15} />{copied ? 'Event link copied' : 'Copy event link'}</button></aside></div>}
    </AdminModal>}
  </div>;
}
