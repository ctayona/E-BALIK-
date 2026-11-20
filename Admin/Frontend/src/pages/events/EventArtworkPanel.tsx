import { useCallback, useEffect, useState, useRef } from 'react';
import { ImagePlus, RefreshCw } from 'lucide-react';
import { BTN } from '../../components/ui/primitives';
import AdminModal from '../../components/ui/AdminModal';
import { fetchEventArtwork, saveEventArtwork, type EventArtwork, type EventDraft } from './eventsApi';

export default function EventArtworkPanel({ event, disabled, onChange, onBusyChange }: { event: EventDraft; disabled: boolean; onChange: (assets: EventArtwork) => void; onBusyChange: (busy: boolean) => void }) {
  const active = useRef(true);
  const [assets, setAssets] = useState<EventArtwork>({ logo: null, banner: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<'logo' | 'banner' | null>(null);
  const load = useCallback(async () => {
    try { const next = await fetchEventArtwork(event.event_id); if (active.current) { setAssets(next); onChange(next); setError(''); } }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Unable to load artwork.'); }
  }, [event.event_id, onChange]);
  useEffect(() => {
    active.current = true;
    setAssets({ logo: null, banner: null }); onChange({ logo: null, banner: null });
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 480000);
    return () => { active.current = false; window.clearInterval(timer); };
  }, [load, onChange]);
  const save = async (kind: 'logo' | 'banner', file: File | null) => {
    if (file && (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError('Use a JPG, PNG or WebP image no larger than 5 MB.'); return; }
    setBusy(true); onBusyChange(true); setError('');
    try { await saveEventArtwork(event.event_id, kind, assets[kind]?.revision || 0, file); setRemove(null); await load(); }
    catch (e) { const message = e instanceof Error ? e.message : 'Unable to save artwork.'; await load(); setError(message); }
    finally { if (active.current) setBusy(false); onBusyChange(false); }
  };
  return <section className="event-editor space-y-4 rounded-2xl border border-line bg-[var(--surface)] p-5 sm:p-6"><div className="event-studio-section"><span><ImagePlus size={15} /></span><h3>The face of your event</h3></div><p className="text-sm leading-6 text-ink-muted">Add a logo and a landscape cover. Artwork is saved separately from event details and stays private while the event is a draft.</p>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-2">{(['logo', 'banner'] as const).map((kind) => <div key={kind} className="rounded-xl border border-line p-3"><div className="mb-3 grid h-28 place-items-center overflow-hidden rounded-xl bg-slate-100">{assets[kind]?.url ? <img src={assets[kind]!.url!} alt={`Current event ${kind}`} className={`h-full w-full ${kind === 'logo' ? 'object-contain p-3' : 'object-cover'}`} /> : <ImagePlus className="text-slate-400" size={25} />}</div><label className="block text-sm font-semibold text-ink" htmlFor={`event-${kind}`}>{kind === 'logo' ? 'Event logo' : 'Cover image'}</label><p className="mb-3 mt-1 text-xs text-ink-muted">{kind === 'logo' ? 'Square artwork works best.' : 'A wide landscape image works best.'} Up to 5 MB.</p><input id={`event-${kind}`} type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-xs text-ink-muted file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-slate-700" disabled={disabled || busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void save(kind, file); }} />{assets[kind]?.url && <button type="button" className="mt-3 text-xs text-rose-700 underline" disabled={disabled || busy} onClick={() => setRemove(kind)}>Remove {kind}</button>}</div>)}</div>
    <button type="button" className={BTN.ghost} disabled={busy} onClick={() => void load()}><RefreshCw size={14} />Refresh artwork</button>{busy && <p role="status" className="text-xs text-ink-muted">Saving artwork…</p>}
    {remove && <AdminModal title={`Remove event ${remove}?`} description="The preview will return to its theme artwork. Existing stored files are retained for recovery." tone="danger" busy={busy} onClose={() => setRemove(null)} footer={<><button type="button" className={BTN.ghost} disabled={busy} onClick={() => setRemove(null)}>Cancel</button><button type="button" className={BTN.primary} disabled={busy} onClick={() => void save(remove, null)}>Remove artwork</button></>} />}
  </section>;
}
