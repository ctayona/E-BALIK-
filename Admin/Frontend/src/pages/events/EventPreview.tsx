import { ArrowUpRight, CalendarDays, MapPin, PackageSearch, Search, ShieldCheck } from 'lucide-react';
import type { EventInput, EventArtwork } from './eventsApi';

function textOn(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const l = .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  return (l + .05) / .05 >= 1.05 / (l + .05) ? '#111111' : '#ffffff';
}

/** Uses only the draft being edited. No report API, demo reports or public navigation. */
export default function EventPreview({ event, phone, artwork }: { event: EventInput; phone: boolean; artwork?: EventArtwork }) {
  const b = event.branding;
  const date = (value: string) => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  return <div className={`event-preview ${phone ? 'event-preview-phone' : ''} event-preview-${b.template}`} style={{
    background: b.background, color: textOn(b.background), borderColor: `${b.primary}33`,
  }}>
    <div className="event-preview-topbar" style={{ borderColor: `${b.primary}22` }}>
      <span className="event-preview-wordmark"><span className="event-preview-mark" style={{ background: b.primary, color: textOn(b.primary) }}>{artwork?.logo?.url ? <img src={artwork.logo.url} alt="Event logo" className="event-preview-logo" /> : <PackageSearch size={16} />}</span>E-Balik<span className="event-preview-divider">/</span>Events</span>
      <span className="event-preview-draft">Private preview</span>
    </div>
    {artwork?.banner?.url && <img className="event-preview-cover" src={artwork.banner.url} alt={`${event.name || 'Event'} cover`} />}
    <header className="event-preview-hero" style={{ background: b.primary, color: textOn(b.primary) }}>
      <div aria-hidden="true" className="event-preview-orbit" style={{ borderColor: `${b.accent}66` }} />
      <div aria-hidden="true" className="event-preview-orbit event-preview-orbit-small" style={{ borderColor: `${b.accent}66` }} />
      <div aria-hidden="true" className="event-preview-glow" style={{ background: b.accent }} />
      <div className="event-preview-hero-content">
        <span className="event-preview-eyebrow"><span style={{ background: b.accent }} />UNIVERSITY OF MAKATI</span>
        <p className="event-preview-kicker">A place for things to find their way home.</p>
        <h3>{event.name || 'Your next campus event'}</h3>
        <p className="event-preview-subtitle">Lost something? Found something?<br />Your event’s recovery desk is here to help.</p>
        <div className="event-preview-meta">
          {event.venue && <span><MapPin size={13} />{event.venue}</span>}
          {event.starts_at && <span><CalendarDays size={13} />{date(event.starts_at)}</span>}
        </div>
        {event.organizer_name && <p className="event-preview-organizer">Hosted by {event.organizer_name}</p>}
      </div>
    </header>
    <div className="event-preview-body">
      <div className="event-preview-action-grid">
        <button type="button" disabled style={{ background: b.accent, color: textOn(b.accent) }}><Search size={20} /><span><strong>I lost an item</strong><small>Start a missing item report</small></span><ArrowUpRight size={17} /></button>
        <button type="button" disabled style={{ borderColor: `${b.primary}33` }}><PackageSearch size={20} /><span><strong>I found an item</strong><small>Help it reach its owner</small></span><ArrowUpRight size={17} /></button>
      </div>
      <div className="event-preview-section-title"><h4>Your event. One recovery hub.</h4><span>LOST &amp; FOUND</span></div>
      <div className="event-preview-empty" style={{ borderColor: `${b.primary}22` }}><span style={{ background: `${b.accent}25` }}><PackageSearch size={25} /></span><strong>Ready for your event</strong><p>Item listings will appear here when event reporting is available.</p></div>
      <section className="event-preview-desk" style={{ borderColor: `${b.primary}22` }}><span className="event-preview-desk-icon" style={{ background: b.primary, color: textOn(b.primary) }}><MapPin size={17} /></span><div><h4>Visit the collection desk</h4><p>{event.desk_instructions || 'Add your desk location and collection instructions.'}</p>{event.recovery_ends_at && <small>Final claiming: {date(event.recovery_ends_at)}</small>}</div></section>
      <footer className="event-preview-footer"><ShieldCheck size={14} /><span>Powered by E-Balik · Preview only · Not published</span></footer>
    </div>
  </div>;
}
