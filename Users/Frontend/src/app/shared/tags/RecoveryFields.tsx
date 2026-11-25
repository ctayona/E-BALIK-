import { useEffect, useRef, useState } from "react";
import CampusVenueSelect from "../../../../../../shared/CampusVenueSelect";
import { useCampusVenues } from "../../../../../../shared/useCampusVenues";
import type { FinderDetails } from "@/app/utils/tags";
import { CX } from "@/app/utils/clay";

type Props = { value: FinderDetails; change: (value: FinderDetails) => void; onLocating?: (waiting: boolean) => void; disabled?: boolean };

export default function RecoveryFields({ value, change, onLocating, disabled }: Props) {
  const venues = useCampusVenues();
  const [notice, setNotice] = useState("");
  const [waiting, setWaiting] = useState(false);
  const sequence = useRef(0);
  const current = useRef(value);
  current.current = value;
  useEffect(() => () => { sequence.current++; onLocating?.(false); }, [onLocating]);

  function markWaiting(next: boolean) {
    setWaiting(next);
    onLocating?.(next);
  }

  function locate() {
    change({ ...current.current, point: null });
    if (!navigator.geolocation || !window.isSecureContext) {
      setNotice("Location is unavailable here. You can still submit a report.");
      return;
    }
    const attempt = ++sequence.current;
    markWaiting(true);
    setNotice("");
    navigator.geolocation.getCurrentPosition(position => {
      if (sequence.current !== attempt) return;
      markWaiting(false);
      const { latitude, longitude, accuracy } = position.coords;
      change({ ...current.current, point: { latitude, longitude, accuracy, captured_at: new Date(position.timestamp).toISOString(), consent_version: "finder-v1" } });
    }, error => {
      if (sequence.current !== attempt) return;
      markWaiting(false);
      setNotice(error.code === 1 ? "Location permission is blocked. Allow location in your browser’s site settings, or send without it."
        : error.code === 3 ? "Your phone timed out finding its location. Retry or send without it."
        : "Location is unavailable. Check that device location is on, or send without it.");
    }, { maximumAge: 0, timeout: 20000, enableHighAccuracy: true });
  }

  return <fieldset disabled={disabled} className="space-y-3 rounded-2xl border border-line p-4 text-ink">
    <legend className={CX.label}>Where did you find the item? (optional)</legend>
    <CampusVenueSelect venues={venues.filter(v => v !== "Other")} value={value.venue}
      onChange={venue => change({ ...value, venue })} label="Found-at location" placeholder="Not sure / elsewhere" className={CX.input + " w-full min-w-0"} />
    <p className={CX.helper}>For an unlisted room or landmark, describe it in your message.</p>
    <p className="text-sm">This finder-report location goes only to the tag owner, not to the admin scan log. To share with admins instead, use Optional scan location on the tag page. Only sending this report shares the point below with the owner, for seven days or until verified return.</p>
    <button type="button" className={CX.btnGhost} disabled={waiting} onClick={locate}>{waiting ? "Getting location…" : value.point ? "Retry location" : "Share my current location"}</button>
    {(waiting || value.point) && <button type="button" className={CX.btnGhost} onClick={() => { sequence.current++; markWaiting(false); change({ ...value, point: null }); setNotice("Location removed."); }}>Remove</button>}
    <p aria-live="polite" className={CX.helper}>{notice || (value.point && `${value.point.latitude.toFixed(5)}, ${value.point.longitude.toFixed(5)} · accuracy ±${Math.round(value.point.accuracy)} m · ${new Date(value.point.captured_at).toLocaleTimeString()}`)}</p>
  </fieldset>;
}
