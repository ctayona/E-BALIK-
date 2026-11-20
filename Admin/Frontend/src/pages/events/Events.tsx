import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, Plus, RefreshCw, Save, FolderOpen, ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { BTN, INPUT, Field, PageHeader } from "../../components/ui/primitives";
import { EventRequestError, fetchEventDrafts, fetchEventDraft, fetchEventOptions, saveEventDraft, type EventDraft, type EventInput, type EventBranding, type EventArtwork } from "./eventsApi";
import EventPreview from "./EventPreview";
import EventStaffPanel from "./EventStaffPanel";
import EventArtworkPanel from "./EventArtworkPanel";
import EventReviewPanel from "./EventReviewPanel";
import EventManageDialog, { type ManageAction } from "./EventManageDialog";
import AdminModal from "../../components/ui/AdminModal";
import EventSetupTabs, { SETUP_STEPS, type SetupStep } from "./EventSetupTabs";
import "./events.css";

const defaults = (): EventInput => ({ name: "", slug: "", organizer_name: "", venue: "", desk_instructions: "", starts_at: null, ends_at: null, recovery_ends_at: null,
  branding: { template: "classic", primary: "#1f3160", accent: "#d1a153", background: "#ffffff" } });
const toInput = (row: EventDraft): EventInput => ({ name: row.name, slug: row.slug, organizer_name: row.organizer_name, venue: row.venue, desk_instructions: row.desk_instructions,
  starts_at: row.starts_at, ends_at: row.ends_at, recovery_ends_at: row.recovery_ends_at, branding: { ...row.branding } });
// Date controls always represent Manila/Singapore UTC+8, independently of the browser's timezone.
const localDate = (value: string | null) => value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16) : "";
const utcDate = (value: string) => value ? new Date(`${value}:00+08:00`).toISOString() : null;
const loadMessage = (error: unknown) => error instanceof EventRequestError && error.code === 'events_disabled'
  ? 'The event module is switched off on the backend. Set EBALIK_EVENTS_FOUNDATION_ENABLED=true in the backend environment, restart the backend, then retry. This does not delete saved events.'
  : error instanceof EventRequestError && error.code === 'setup_required'
  ? 'Event tables are unavailable. Verify the event foundation migration in the connected database before applying SQL. This screen cannot determine whether saved events exist.'
  : error instanceof Error ? error.message : 'Unable to load events. Check the connection and retry.';

export default function Events({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [rows, setRows] = useState<EventDraft[]>([]);
  const [venues, setVenues] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState('all');
  const [managementAvailable, setManagementAvailable] = useState(false);
  const [manageTarget, setManageTarget] = useState<{ event: EventDraft; action: ManageAction } | null>(null);
  const [selected, setSelected] = useState<EventDraft | null>(null);
  const [form, setForm] = useState<EventInput>(defaults);
  const [original, setOriginal] = useState(() => JSON.stringify(defaults()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [artworkBusy, setArtworkBusy] = useState(false);
  const [staffBusy, setStaffBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [artwork, setArtwork] = useState<EventArtwork>({ logo: null, banner: null });
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [mobile, setMobile] = useState(false);
  const [step, setStep] = useState<SetupStep>('details');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [listError, setListError] = useState('');
  const [optionsError, setOptionsError] = useState('');
  const loadSequence = useRef(0);
  const initialPicker = useRef(true);
  const dirty = JSON.stringify(form) !== original;
  useEffect(() => {
    onDirtyChange?.(dirty || artworkBusy || staffBusy || lifecycleBusy);
    return () => onDirtyChange?.(false);
  }, [dirty, artworkBusy, staffBusy, lifecycleBusy, onDirtyChange]);
  const unavailable = code === "events_disabled" || code === "setup_required";
  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setListError(''); setOptionsError('');
    const [drafts, options] = await Promise.allSettled([fetchEventDrafts(offset, view, signal), fetchEventOptions(signal)]);
    if (signal?.aborted || sequence !== loadSequence.current) return;
    if (drafts.status === 'fulfilled') {
      setRows(drafts.value.events); setManagementAvailable(drafts.value.management_available === true);
      if (initialPicker.current) { initialPicker.current = false; if (drafts.value.events.length) setPickerOpen(true); }
    } else { setRows([]); setManagementAvailable(false); setListError(loadMessage(drafts.reason)); }
    if (options.status === 'fulfilled') { setVenues(options.value); }
    else { setVenues([]); setOptionsError(loadMessage(options.reason)); }
    if (drafts.status === 'fulfilled' && options.status === 'fulfilled') { setError(''); setCode(''); }
    setLoading(false);
  }, [offset, view]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => { controller.abort(); loadSequence.current += 1; }; }, [load]);
  useEffect(() => {
    if (!dirty && !artworkBusy && !staffBusy && !lifecycleBusy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, artworkBusy, staffBusy, lifecycleBusy]);
  const choose = (row: EventDraft | null) => {
    const next = row ? toInput(row) : defaults();
    setSelected(row); setForm(next); setOriginal(JSON.stringify(next)); setMessage("");
    setPickerOpen(false);
    if (row?.event_id !== selected?.event_id) setArtwork({ logo: null, banner: null });
  };
  const change = <K extends keyof EventInput>(key: K, value: EventInput[K]) => setForm((old) => ({ ...old, [key]: value }));
  const color = (key: keyof EventBranding, value: string) => setForm((old) => ({ ...old, branding: { ...old.branding, [key]: value } }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    if (selected && selected.status !== 'draft') { setError('Return this event to draft before editing its details.'); return; }
    if (!form.name.trim()) { setStep('details'); setError('Enter an event name before saving.'); return; }
    const dates = [form.starts_at, form.ends_at, form.recovery_ends_at];
    if (dates.some(Boolean) && !dates.every(Boolean)) { setStep('schedule'); setError("Set all three dates, or clear all three to plan them later."); return; }
    if (dates.every(Boolean) && !(Date.parse(dates[0]!) < Date.parse(dates[1]!) && Date.parse(dates[1]!) <= Date.parse(dates[2]!))) { setStep('schedule'); setError("The event must start before it ends, and recovery must end on or after the event."); return; }
    setSaving(true);
    try {
      const saved = await saveEventDraft(form, selected);
      choose(saved);
      setRows((old) => [saved, ...old.filter((row) => row.event_id !== saved.event_id)].slice(0, 50));
      setOffset(0); setView('drafts');
      setCode(""); setMessage("Draft saved. Attendee access remains closed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save draft."); setCode(e instanceof EventRequestError ? e.code : "request_failed");
    } finally { setSaving(false); }
  };
  const reloadSelected = async () => {
    setLoading(true);
    try {
      const row = selected ? await fetchEventDraft(selected.event_id) : null;
      if (!row) { setError("This draft is not on the current page. Return to its page before reloading."); return; }
      choose(row); void load(); setError(""); setCode("");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to reload."); }
    finally { setLoading(false); }
  };
  const locked = !!selected && (selected.status !== 'draft' || !!selected.deleted_at);
  const blocked = loading || saving || artworkBusy || staffBusy || lifecycleBusy || unavailable || !!listError || !!optionsError || venues.length === 0;
  const busy = saving || artworkBusy || staffBusy || lifecycleBusy;
  const transitioned = (row: EventDraft) => { if (row.deleted_at) { choose(null); void load(); setStep('details'); setMessage('Event moved to Deleted. Restore it from Workspaces when needed.'); return; } choose(row); void load(); setMessage(`Event is now ${row.status}. Review attendee portal access below.`); };
  const stepIndex = SETUP_STEPS.findIndex((item) => item.id === step);
  return <div className="event-workspace event-workspace-compact space-y-4 p-4 sm:p-6">
    <PageHeader title="Events" description="Create a campus recovery experience, one detail at a time." actions={<>
      <button type="button" className={BTN.ghost} disabled={busy || dirty} onClick={() => setPickerOpen(true)}><FolderOpen size={16} />Workspaces</button>
      <button type="button" className={BTN.ghost} disabled={loading} onClick={() => setPreviewOpen(true)}><Eye size={16} />Preview</button>
      <button type="button" className={BTN.primary} disabled={blocked || dirty} onClick={() => { choose(null); setStep('details'); }}><Plus size={16} />New event</button>
    </>} />
    {(listError || optionsError) && <div role="alert" className="event-load-error"><strong>Event setup could not be fully loaded</strong>{[...new Set([listError, optionsError].filter(Boolean))].map((text) => <p key={text}>{text}</p>)}<button type="button" className={BTN.ghost} disabled={loading || busy} onClick={() => void load()}><RefreshCw size={15} />Retry event setup</button></div>}
    {error && <div role="alert" className="event-load-error">{unavailable ? loadMessage(new EventRequestError(error, code)) : error}
      {code === "version_conflict" && <button type="button" className={BTN.ghost + " ml-3"} disabled={loading || busy} onClick={() => void reloadSelected()}>Discard changes and reload</button>}
    </div>}
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    <div className="event-setup-shell">
      <header className="event-setup-heading"><div className="min-w-0"><span className="event-studio-eyebrow">E-BALIK / EVENT STUDIO</span><h2 title={form.name || 'Untitled event'}>{form.name || 'Your next campus event'}</h2><p>{selected ? 'Refine your saved workspace.' : 'Start with the essentials. Save to add artwork and your team.'}</p></div><span className="event-private-badge"><ShieldCheck size={13} />{selected?.status || 'draft'}</span></header>
      <EventSetupTabs value={step} onChange={setStep} disabled={busy} />
      <div className="event-setup-content">
        {locked && step !== 'review' && <p className="event-panel-note">Details and artwork are locked while this event is {selected.status}. Open Review to see available state changes.</p>}
        <form id="event-draft-form" noValidate onSubmit={(e) => void save(e)}>
          <section className="event-step-panel" id="event-panel-details" role="tabpanel" aria-labelledby="event-step-details" hidden={step !== 'details'} tabIndex={0}>
            <div className="event-panel-heading"><h3>The essentials</h3><p>A recognizable name and a clear collection point help people find you.</p></div>
            <fieldset disabled={blocked || locked} className="grid gap-4 sm:grid-cols-2 disabled:opacity-60">
              <Field label="Event name" required>{(id) => <input id={id} className={INPUT} required maxLength={120} value={form.name} placeholder="e.g. UMak Foundation Week" onChange={(e) => change("name", e.target.value)} />}</Field>
              <Field label="Organizer">{(id) => <input id={id} className={INPUT} maxLength={160} value={form.organizer_name} onChange={(e) => change("organizer_name", e.target.value)} />}</Field>
              <Field label="University venue" hint="Using the existing campus list for now.">{(id) => <select id={id} className={INPUT} value={form.venue} onChange={(e) => change("venue", e.target.value)}><option value="">Choose a campus venue</option>{form.venue && !venues.includes(form.venue) && <option value={form.venue} disabled>{form.venue} ? select a campus venue</option>}{venues.map((venue) => <option key={venue} value={venue}>{venue}</option>)}</select>}</Field>
              <Field label="Collection desk instructions">{(id) => <textarea id={id} className={INPUT + " py-3"} rows={3} maxLength={1000} value={form.desk_instructions} placeholder="Where should attendees go to collect an item?" onChange={(e) => change("desk_instructions", e.target.value)} />}</Field>
            </fieldset>
            <p className="event-panel-note">{selected ? <>Event reference: <span className="break-all">{selected.slug}</span>. Renaming keeps this reference.</> : 'Your event reference is generated automatically when you save.'}</p>
          </section>
          <section className="event-step-panel" id="event-panel-schedule" role="tabpanel" aria-labelledby="event-step-schedule" hidden={step !== 'schedule'} tabIndex={0}>
            <div className="event-panel-heading"><h3>Make room for recovery</h3><p>Set your event dates and give attendees time to collect belongings afterward.</p></div>
            <fieldset disabled={blocked || locked} className="grid gap-4 lg:grid-cols-3 disabled:opacity-60">
              {([['starts_at', 'Event starts'], ['ends_at', 'Event ends'], ['recovery_ends_at', 'Final claiming date']] as const).map(([key, label]) => <Field key={key} label={label}>{(id) => <input id={id} type="datetime-local" className={INPUT} value={localDate(form[key])} onChange={(e) => change(key, utcDate(e.target.value))} />}</Field>)}
            </fieldset>
            <div className="event-panel-note">All times use Manila time (UTC+8). Leave all three blank if undecided. The claiming deadline must be on or after the event ends.</div>
          </section>
          <section className="event-step-panel" id="event-panel-appearance" role="tabpanel" aria-labelledby="event-step-appearance" hidden={step !== 'appearance'} tabIndex={0}>
            <div className="event-panel-heading"><h3>A look that belongs to your event</h3><p>Choose a palette, make it yours, and open Preview to see the complete attendee layout.</p></div>
            <fieldset disabled={blocked || locked} className="space-y-5 disabled:opacity-60">
              <div className="event-theme-options" aria-label="Event theme presets">{([
                { id: "classic", label: "Heritage", note: "Navy, gold & quiet elegance", primary: "#1f3160", accent: "#d1a153", background: "#fffdf8" },
                { id: "festival", label: "Afterglow", note: "Plum, rose & a soft glow", primary: "#382344", accent: "#edb0a8", background: "#fff9f6" },
                { id: "sports", label: "Fieldhouse", note: "Forest, lime & bold lines", primary: "#183b35", accent: "#d5e8a1", background: "#f8fbf5" },
              ] as const).map((preset) => <button key={preset.id} type="button" aria-pressed={form.branding.template === preset.id} onClick={() => change("branding", { template: preset.id, primary: preset.primary, accent: preset.accent, background: preset.background })}><span className="event-theme-swatch" style={{ background: 'linear-gradient(125deg, ' + preset.primary + ' 60%, ' + preset.accent + ')' }} /><strong>{preset.label}</strong><small>{preset.note}</small></button>)}</div>
              <div className="flex flex-wrap items-end gap-4"><div className="grid min-w-0 flex-1 grid-cols-3 gap-3">{(['primary', 'accent', 'background'] as const).map((key) => <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>{(id) => <input id={id} aria-label={key + ' color'} type="color" className="h-11 w-full cursor-pointer rounded-lg border border-line" value={form.branding[key]} onChange={(e) => color(key, e.target.value)} />}</Field>)}</div><button type="button" className={BTN.ghost} onClick={() => change("branding", defaults().branding)}>Reset palette</button></div>
            </fieldset>
            <p className="event-panel-note">Only this event uses these colors. Your campus dashboard keeps its own theme.</p>
          </section>
        </form>
        <section className="event-step-panel" id="event-panel-artwork" role="tabpanel" aria-labelledby="event-step-artwork" hidden={step !== 'artwork'} tabIndex={0}>
          {selected ? <EventArtworkPanel key={'art-' + selected.event_id} event={selected} disabled={saving || staffBusy || lifecycleBusy || locked || dirty} onChange={setArtwork} onBusyChange={setArtworkBusy} /> : <div className="event-setup-empty"><h3>Give your event a face</h3><p>Save the event draft first, then add a logo and a landscape cover here.</p><button type="button" className={BTN.ghost} onClick={() => setStep('details')}>Return to details</button></div>}
        </section>
        <section className="event-step-panel" id="event-panel-team" role="tabpanel" aria-labelledby="event-step-team" hidden={step !== 'team'} tabIndex={0}>
          {selected ? <EventStaffPanel key={'team-' + selected.event_id} event={selected} disabled={saving || artworkBusy || staffBusy || lifecycleBusy || ['closed', 'archived', 'cancelled'].includes(selected.status) || dirty} onBusyChange={setStaffBusy} onEditSchedule={() => setStep('schedule')} /> : <div className="event-setup-empty"><h3>A team for every return</h3><p>Save the event draft first, then find and assign your event staff here.</p><button type="button" className={BTN.ghost} onClick={() => setStep('details')}>Return to details</button></div>}
        </section>
        <section className="event-step-panel" id="event-panel-review" role="tabpanel" aria-labelledby="event-step-review" hidden={step !== 'review'} tabIndex={0}>
          {selected ? <EventReviewPanel key={selected.event_id} event={selected} visible={step === 'review'} disabled={blocked || dirty} onStep={setStep} onChange={transitioned} onBusyChange={setLifecycleBusy} /> : <div className="event-setup-empty"><h3>Save, then review</h3><p>Save your event draft to check readiness and unlock its next steps.</p></div>}
        </section>
      </div>
      <footer className="event-setup-footer"><div className="event-save-state" role="status"><span className={dirty ? 'event-state-dot event-state-unsaved' : 'event-state-dot'} /><span>{busy ? 'Saving changes?' : dirty ? 'Unsaved event changes' : selected ? 'Event details saved' : 'New event draft'}</span></div><div className="event-setup-footer-actions">
        <button type="button" className={BTN.ghost} disabled={busy || stepIndex === 0} onClick={() => setStep(SETUP_STEPS[stepIndex - 1].id)} aria-label="Previous setup step"><ArrowLeft size={15} /><span className="hidden sm:inline">Back</span></button>
        {stepIndex < SETUP_STEPS.length - 1 && <button type="button" className={BTN.ghost} disabled={busy} onClick={() => setStep(SETUP_STEPS[stepIndex + 1].id)}>Next<ArrowRight size={15} /></button>}
        <button type="button" className={BTN.ghost} disabled={busy || !dirty} onClick={() => choose(selected)}>Discard</button>
        <button type="submit" form="event-draft-form" className={BTN.primary} disabled={blocked || locked || !dirty}><Save size={15} />{saving ? 'Saving…' : 'Save draft'}</button>
      </div></footer>
    </div>
    <p className="event-workspace-footnote">Event reports stay scoped to their event. Open attendee access separately in Review.</p>
    {pickerOpen && <AdminModal busy={busy} title="Your event workspaces" description="Your saved drafts and event history. Choose Drafts to continue an unfinished setup." size="lg" icon={<FolderOpen size={21} />} onClose={() => setPickerOpen(false)} footer={<><button type="button" className={BTN.primary} disabled={blocked || dirty} onClick={() => { choose(null); setStep('details'); }}>New event</button><button type="button" className={BTN.ghost} disabled={loading || busy || !!listError || offset === 0} onClick={() => setOffset((v) => Math.max(0, v - 50))}>Previous</button><button type="button" className={BTN.ghost} disabled={loading || busy || !!listError || rows.length < 50} onClick={() => setOffset((v) => v + 50)}>Next</button></>}>
      <nav className="event-workspace-filters" aria-label="Event workspace views">{[['all','All'],['drafts','Drafts'],['open','Open'],['closed','Closed'],['archived','Archived'],['deleted','Deleted']].map(([key,label]) => <button type="button" key={key} aria-pressed={view === key} disabled={busy || key === 'deleted' && !managementAvailable} onClick={() => { setOffset(0); setView(key); }}>{label}</button>)}</nav>
      {!loading && !listError && !managementAvailable && <p role="status" className="event-panel-note">Archive, delete and restore are unavailable on this backend. Verify the event recovery setup before applying any migration. You can still open events and edit drafts.</p>}
      <div className="mb-3 flex items-center justify-between"><p className="text-sm text-ink-muted">{listError ? 'Event list unavailable' : loading ? 'Reading saved workspaces' : `${rows.length} events on this page`}</p><button type="button" aria-label="Refresh event workspaces" className={BTN.ghost} disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button></div>
      {loading ? <p role="status" className="py-8 text-center text-sm text-ink-muted">Loading events...</p> : listError ? <div role="alert" className="event-load-error"><strong>Saved events could not be loaded</strong><p>{listError}</p><button type="button" className={BTN.ghost} onClick={() => void load()}>Retry loading workspaces</button></div> : rows.length === 0 ? <p className="py-8 text-center text-sm text-ink-muted">No events in this view.</p> : <ul className="grid gap-3 sm:grid-cols-2">{rows.map((row) => <li key={row.event_id} className="event-workspace-choice"><button type="button" disabled={!!row.deleted_at || busy} onClick={() => { choose(row); setStep(row.status === 'draft' ? 'details' : 'review'); }} aria-pressed={selected?.event_id === row.event_id} className={'event-draft-choice ' + (selected?.event_id === row.event_id ? 'event-draft-choice-active' : '')}><span className="event-draft-monogram">{row.name.charAt(0).toUpperCase()}</span><span className="min-w-0"><strong>{row.name}</strong><small>{row.venue || 'Venue not set'} / {row.deleted_at ? 'Deleted' : row.status}</small></span></button><div className="event-workspace-row-actions">{row.deleted_at ? <button type="button" className={BTN.ghost} disabled={busy} onClick={() => setManageTarget({event:row,action:'restore'})}>Restore</button> : <>{['scheduled','active','recovery'].includes(row.status) && <><button type="button" className={BTN.ghost} disabled={busy} onClick={() => { choose(row); setStep('review'); }}>Review event</button>{managementAvailable && <button type="button" className={BTN.ghost} disabled={busy} onClick={() => setManageTarget({event:row,action:'cancel'})}>Cancel event...</button>}<p className="event-workspace-hint">Cancel before deleting. Cancellation closes attendee and staff access.</p></>}{row.status === 'draft' && <button type="button" className={BTN.ghost} disabled={busy} onClick={() => { choose(row); setStep('details'); }}>Edit draft</button>}{managementAvailable && ['closed','cancelled'].includes(row.status) && <button type="button" className={BTN.ghost} disabled={busy} onClick={() => setManageTarget({event:row,action:'archive'})}>Archive</button>}{managementAvailable && ['draft','closed','cancelled','archived'].includes(row.status) && <button type="button" className={BTN.ghost} disabled={busy} onClick={() => setManageTarget({event:row,action:'delete'})}>Move to Deleted</button>}</>}</div></li>)}</ul>}
    </AdminModal>}
    {manageTarget && <EventManageDialog event={manageTarget.event} action={manageTarget.action} onClose={() => setManageTarget(null)} onBusyChange={setLifecycleBusy} onChanged={(row) => { choose(row.deleted_at ? null : row); setStep(row.status === 'draft' ? 'details' : 'review'); setPickerOpen(true); void load(); setMessage(row.status === 'cancelled' && !row.deleted_at ? 'Event cancelled. You can now archive it or move it to Deleted if no unreleased items remain in custody.' : 'Workspace updated. Reports and history are retained.'); }} />}
    {previewOpen && <AdminModal title="Event appearance preview" description="Review your current design. Unsaved edits are included; nothing is published." size="xl" icon={<Eye size={21} />} onClose={() => setPreviewOpen(false)} footer={<><button type="button" className={BTN.ghost} aria-pressed={mobile} onClick={() => setMobile(true)}>Phone</button><button type="button" className={BTN.ghost} aria-pressed={!mobile} onClick={() => setMobile(false)}>Wide</button><button type="button" className={BTN.primary} onClick={() => setPreviewOpen(false)}>Back to setup</button></>}><div className="event-preview-stage event-preview-modal"><EventPreview event={form} phone={mobile} artwork={artwork} /></div></AdminModal>}
  </div>;
}
