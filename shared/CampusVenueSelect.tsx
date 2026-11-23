import { facilityNames } from "./campus";

interface Props {
  venues: string[];
  value: string;
  onChange: (venue: string) => void;
  id?: string;
  label?: string;
  className?: string;
  placeholder?: string;
}

/** Stored values stay exact text. Only paths offered by the server can be newly selected. */
export default function CampusVenueSelect({venues, value, onChange, id, className, label = "University venue", placeholder = "Choose a campus venue"}: Props) {
  const known = venues.includes(value);
  const [building, floor] = value.split(" / ");
  const parts = venues.map(venue => venue.split(" / "));
  const prefix = [building, floor].join(" / ");
  const floors = parts.filter(path => path.length === 2 && path[0] === building);
  const rooms = parts.filter(path => path.length === 3 && path[0] === building && path[1] === floor);
  return <div className="grid min-w-0 gap-2">
    <select id={id} aria-label={label} className={className} value={known ? building : value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {!known && value && <option value={value} disabled>{value} (recorded)</option>}
      {parts.filter(path => path.length === 1).map(([area]) => <option key={area}>{area}</option>)}
    </select>
    {known && floors.length > 0 && <select aria-label={label + " floor"} className={className} value={floor ? prefix : building} onChange={e => onChange(e.target.value)}>
      <option value={building}>Building only · choose floor</option>
      {floors.map(path => <option key={path[1]} value={path.join(" / ")}>{path[1]}</option>)}
    </select>}
    {known && rooms.length > 0 && <select aria-label={label + " room"} className={className} value={value} onChange={e => onChange(e.target.value)}>
      <option value={prefix}>Floor only · choose room</option>
      {rooms.map(path => <option key={path[2]} value={path.join(" / ")}>{[path[2], facilityNames[path.join(" / ")]].filter(Boolean).join(" · ")}</option>)}
    </select>}
  </div>;
}
