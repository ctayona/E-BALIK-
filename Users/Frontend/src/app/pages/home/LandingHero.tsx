import { useState } from 'react';
import { ArrowDown, ArrowUpRight, MapPin, PackageSearch, ShieldCheck } from 'lucide-react';
import umakLogo from '@/imports/umaklogo.webp';
import campusPhoto from '@/assets/campus/umak-campus-oval.jpg';
import type { PublicBoard } from '@/app/utils/api';

export default function LandingHero({ onLogin, board, loading, liveAuctions }: { onLogin: () => void; board: PublicBoard | null; loading: boolean; liveAuctions: number | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <section className="landing-hero" aria-labelledby="landing-title">
    <div className="landing-hero-copy">
      <span className="landing-eyebrow"><span />FOR THE UMAK COMMUNITY</span>
      <h1 id="landing-title">Lost things.<br /><em>Found here.</em></h1>
      <p className="landing-hero-intro">Your everyday essentials have a way back. Report a missing item, find what’s been handed in, and reconnect with what matters.</p>
      <div className="landing-hero-actions"><button className="landing-button landing-button-primary" onClick={onLogin}>Report a lost item<ArrowUpRight size={19} /></button><a className="landing-button landing-button-outline" href="#campus-board">Explore the board<ArrowDown size={17} /></a></div>
      <p className="landing-trust"><ShieldCheck size={16} />Private ownership checks. Staff-assisted returns.</p>
      <dl className="landing-live-counts" aria-label="Current campus activity">{[
        { label: 'Missing reports', value: loading || !board ? '—' : board.counts.missing },
        { label: 'Items in custody', value: loading || !board ? '—' : board.counts.found },
        ...(liveAuctions === null ? [] : [{ label: 'Live auctions', value: liveAuctions }]),
      ].map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>
    <div className="landing-campus-composition">
      <figure className="landing-campus-photo">
        {!imageFailed ? <img src={campusPhoto} width={1280} height={853} loading="eager" decoding="async" alt="The University of Makati oval, running track and campus buildings" onError={() => setImageFailed(true)} /> : <div className="landing-campus-fallback"><img src={umakLogo} alt="University of Makati seal" /><p>University of Makati</p><span>A community that looks out for one another.</span></div>}
        <div className="landing-campus-shade" />
        <span className="landing-photo-kicker">OUR CAMPUS. OUR COMMUNITY.</span>
        <figcaption><MapPin size={18} /><div><strong>University of Makati</strong><span>A shared place. A little more care.</span></div></figcaption>
      </figure>
      <div className="landing-return-card"><span><PackageSearch size={25} /></span><div><strong>Every return starts<br />with someone who cares.</strong><p>Lost & found, connected by E-Balik.</p></div><ArrowUpRight size={21} /></div>
      <span className="landing-photo-index" aria-hidden="true">01 / THE PLACE WE CALL CAMPUS</span>
    </div>
  </section>;
}
