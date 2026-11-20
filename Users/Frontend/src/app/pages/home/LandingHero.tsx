import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowUpRight, ChevronLeft, ChevronRight, MapPin, PackageSearch, Pause, Play, ShieldCheck } from 'lucide-react';
import umakLogo from '@/imports/umaklogo.webp';
import campusPhoto from '@/assets/campus/umak-campus-oval.jpg';
import aerialPhoto from '@/assets/campus/umak-campus-aerial.jpg';
import classroomPhoto from '@/assets/campus/umak-classroom.jpg';
import buildingPhoto from '@/assets/campus/umak-building.jpg';
import stadiumPhoto from '@/assets/campus/umak-stadium.jpg';
import type { PublicBoard } from '@/app/utils/api';

const photos = [
  { src: campusPhoto, height: 853, location: 'University of Makati', caption: 'A shared place. A little more care.', alt: 'The University of Makati oval, running track and campus buildings', author: 'Steverv0206', source: 'University_of_Makati_Oval.jpg', license: '4.0' },
  { src: aerialPhoto, height: 720, location: 'Our campus, connected', caption: 'Academic buildings, shared spaces, one community.', alt: 'Elevated view of the University of Makati campus buildings and green spaces', author: 'Patrick Roque', source: 'University_of_Makati_(J.P._Rizal_Avenue,_Makati)(2018-04-24)_cropped.jpg', license: '4.0' },
  { src: classroomPhoto, height: 682, location: 'Inside the HPSB', caption: 'A place to learn. A community to look out for.', alt: 'Lecture room inside the University of Makati Health and Physical Science Building', author: 'Umakcorpcomm', source: 'HPSB_Lecture_Room_in_New_Normal.jpg', license: '4.0' },
  { src: buildingPhoto, height: 853, location: 'A familiar campus landmark', caption: 'Everyday journeys start with familiar places.', alt: 'University of Makati building and the surrounding city skyline', author: 'Elmer B. Domingo', source: 'University_of_Makati.JPG', license: '3.0' },
  { src: stadiumPhoto, height: 720, location: 'University of Makati Stadium', caption: 'Room to gather. Reasons to care.', alt: 'Inside the University of Makati stadium, overlooking the playing field and track', author: 'Hariboneagle927', source: 'University_of_Makati_Stadium_Aug_16_2017.jpg', license: '4.0' },
];

export default function LandingHero({ onLogin, board, loading, liveAuctions }: { onLogin: () => void; board: PublicBoard | null; loading: boolean; liveAuctions: number | null }) {
  const [active, setActive] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const frame = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const photo = photos[active];
  const rotating = reducedMotion === false && !paused && !hovered && !focused && visible && pageVisible;

  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    if (frame.current) observer.observe(frame.current);
    return () => { document.removeEventListener('visibilitychange', updateVisibility); observer.disconnect(); };
  }, []);

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => setActive(value => (value + 1) % photos.length), 7000);
    return () => window.clearInterval(timer);
  }, [rotating]);

  useEffect(() => {
    if (!visible) return;
    const nextImage = new Image();
    nextImage.decoding = 'async';
    nextImage.src = photos[(active + 1) % photos.length].src;
  }, [active, visible]);

  const changePhoto = (direction: number) => {
    setPaused(true);
    setActive(value => (value + direction + photos.length) % photos.length);
  };
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
    <div className="landing-campus-composition" ref={frame} role="region" aria-roledescription="carousel" aria-label="Our University of Makati campus" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
      <figure className="landing-campus-photo" aria-roledescription="slide" aria-label={`Photo ${active + 1} of ${photos.length}`}>
        {!failedImages.has(photo.src) ? <img key={photo.src} src={photo.src} width={1280} height={photo.height} loading="eager" decoding="async" alt={photo.alt} onError={() => setFailedImages(previous => new Set(previous).add(photo.src))} /> : <div className="landing-campus-fallback"><img src={umakLogo} alt="University of Makati seal" /><p>University of Makati</p><span>A community that looks out for one another.</span></div>}
        <div className="landing-campus-shade" />
        <span className="landing-photo-kicker">OUR CAMPUS. OUR COMMUNITY.</span>
        <div className="landing-slideshow-controls">
          <button type="button" aria-label="Previous hero photo" onClick={() => changePhoto(-1)}><ChevronLeft size={18} /></button>
          <span aria-hidden="true">{String(active + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}</span>
          <button type="button" aria-label="Next hero photo" onClick={() => changePhoto(1)}><ChevronRight size={18} /></button>
          <button type="button" aria-label={reducedMotion !== false ? 'Automatic slideshow disabled for reduced motion' : paused ? 'Play campus slideshow' : 'Pause campus slideshow'} disabled={reducedMotion !== false} onClick={() => setPaused(value => !value)}>{paused || reducedMotion !== false ? <Play size={15} /> : <Pause size={15} />}</button>
        </div>
        <figcaption aria-live={rotating ? 'off' : 'polite'} aria-atomic="true"><MapPin size={18} /><div><strong>{photo.location}</strong><span>{photo.caption}</span></div></figcaption>
      </figure>
      <div className="landing-return-card"><span><PackageSearch size={25} /></span><div><strong>Every return starts<br />with someone who cares.</strong><p>Lost & found, connected by E-Balik.</p></div><ArrowUpRight size={21} /></div>
      <p className="landing-slideshow-credit">Archival photo: <a href={`https://commons.wikimedia.org/wiki/File:${photo.source}`} target="_blank" rel="noreferrer">{photo.author}</a> / <a href={`https://creativecommons.org/licenses/by-sa/${photo.license}/`} target="_blank" rel="noreferrer">CC BY-SA {photo.license}</a> · resized &amp; cropped.</p>
      <span className="landing-photo-index" aria-hidden="true">{String(active + 1).padStart(2, '0')} / THE PLACE WE CALL CAMPUS</span>
    </div>
  </section>;
}
