import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin } from 'lucide-react';
import buildingPhoto from '@/assets/campus/umak-building.jpg';
import stadiumPhoto from '@/assets/campus/umak-stadium.jpg';

const photos = [
  { src: buildingPhoto, height: 853, title: 'A familiar place to begin.', location: 'University of Makati campus', alt: 'University of Makati building with the city skyline behind it', year: '2012', author: 'Elmer B. Domingo', source: 'https://commons.wikimedia.org/wiki/File:University_of_Makati.JPG', license: '3.0' },
  { src: stadiumPhoto, height: 720, title: 'Room to come together.', location: 'University of Makati Stadium', alt: 'University of Makati stadium, green playing field and running track', year: '2017', author: 'Hariboneagle927', source: 'https://commons.wikimedia.org/wiki/File:University_of_Makati_Stadium_Aug_16_2017.jpg', license: '4.0' },
];

function CampusPhoto({ photo }: { photo: typeof photos[number] }) {
  const [failed, setFailed] = useState(false);
  return <figure className="landing-gallery-card">
    <div className="landing-gallery-image">{failed ? <div className="landing-gallery-fallback"><MapPin size={32} aria-hidden="true" /><span>{photo.location}</span></div> : <img src={photo.src} width={1280} height={photo.height} loading="lazy" decoding="async" alt={photo.alt} onError={() => setFailed(true)} />}</div>
    <figcaption>
      <p className="landing-gallery-location"><MapPin size={13} aria-hidden="true" />{photo.location}</p>
      <h3>{photo.title}</h3>
      <p className="landing-gallery-credit"><a href={photo.source} target="_blank" rel="noreferrer">{photo.author}</a> · <a href={`https://creativecommons.org/licenses/by-sa/${photo.license}/`} target="_blank" rel="noreferrer">CC BY-SA {photo.license}</a> · {photo.year}</p>
    </figcaption>
  </figure>;
}

export default function LandingCampusGallery() {
  const track = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const updatePosition = () => {
    const el = track.current;
    if (el) setPosition(el.scrollLeft > (el.scrollWidth - el.clientWidth) / 2 ? 1 : 0);
  };
  useEffect(() => {
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, []);
  const move = (index: number) => {
    const el = track.current, card = el?.children[index];
    if (!el || !card) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';
    el.scrollTo({ left: el.scrollLeft + card.getBoundingClientRect().left - el.getBoundingClientRect().left, behavior: reduce ? 'auto' : 'smooth' });
  };
  return <section className="landing-gallery" aria-labelledby="campus-gallery-title">
    <div className="landing-gallery-heading"><div><p className="landing-eyebrow">THE PLACES THAT CONNECT US</p><h2 id="campus-gallery-title">A place we share.</h2></div><p>Between classes, across the field, and through everyday campus life — looking out for each other starts here.</p></div>
    <div className="landing-gallery-track" id="campus-photo-gallery" ref={track} onScroll={updatePosition} role="region" aria-label="University of Makati photographs" tabIndex={0}>{photos.map(photo => <CampusPhoto key={photo.src} photo={photo} />)}</div>
    <div className="landing-gallery-controls"><span aria-live="polite">Photo {position + 1} of {photos.length}</span><div><button type="button" aria-label="Previous campus photo" aria-controls="campus-photo-gallery" disabled={position === 0} onClick={() => move(0)}><ArrowLeft size={18} /></button><button type="button" aria-label="Next campus photo" aria-controls="campus-photo-gallery" disabled={position === 1} onClick={() => move(1)}><ArrowRight size={18} /></button></div></div>
    <p className="landing-gallery-note">Archival campus views, resized and cropped for this gallery. No endorsement implied.</p>
  </section>;
}
