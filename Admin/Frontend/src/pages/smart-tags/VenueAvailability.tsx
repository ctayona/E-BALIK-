import { useId, useState } from "react";
import { MapPin, Plus, RefreshCw } from "lucide-react";
import catalogue from "../../../../../shared/campus.json";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, INPUT } from "../../components/ui/primitives";
import { manageVenue, venueAvailability, type VenueRow } from "../../utils/smartTagsApi";

export default function VenueAvailability() {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<VenueRow[]>([]);
  const [editable, setEditable] = useState(false);
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"create" | "rename">("create");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [room, setRoom] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = rows.find(r => r.label === label);
  const legacy = catalogue.legacy.includes(label);
  const target = [building, floor, room].map(v => v.trim()).filter(Boolean).join(" / ");
  const invalid = !building.trim() || (!!room.trim() && !floor.trim()) ||
    [building, floor, room].some(v => /[<>/\u0000-\u001f]/.test(v)) || target.length > 80;
  async function load() {
    const data = await venueAvailability();
    setRows(data.venues); setEditable(data.editable);
  }
  async function refresh() {
    setBusy(true); setMessage("");
    try { await load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Unable to load locations."); }
    finally { setBusy(false); }
  }
  function choose(value: string) {
    setLabel(value); setMode("rename"); setMessage("");
    const [b = "", f = "", r = ""] = value.split(" / ");
    setBuilding(b); setFloor(f); setRoom(r);
  }
  async function save(action: "create" | "rename" | "availability") {
    setBusy(true); setMessage("");
    try {
      const result = await manageVenue({ action, label, target, active: !selected?.active, version: selected?.version ?? 0 });
      await load(); setLabel(result.label); setMode("rename");
      setMessage("Saved. Newly opened report forms will use the updated list.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save location."); }
    finally { setBusy(false); }
  }
  return <section className="glass-panel p-4 text-ink">
    <button type="button" className={BTN.ghost} onClick={() => { setOpen(true); void refresh(); }}><MapPin size={17} />Manage UMak venues</button>
    {open && <AdminModal title="Campus locations" description="Maintain the buildings, floors and rooms offered across E-Balik." icon={<MapPin size={22} />} size="lg" busy={busy} onClose={() => setOpen(false)}
      footer={<button type="button" className={BTN.ghost} disabled={busy} onClick={() => setOpen(false)}>Close</button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN.primary} disabled={busy || !editable} onClick={() => { choose(""); setMode("create"); }}><Plus size={16} />Add location</button>
          <button type="button" className={BTN.ghost} disabled={busy} onClick={() => void refresh()}><RefreshCw size={16} />Refresh</button>
        </div>
        {!editable && <p className="text-sm text-ink-soft">Editing requires the venue management migration.</p>}
        <label className="block space-y-2 text-sm font-medium">Search locations<input className={INPUT} value={search} onChange={e => setSearch(e.target.value)} placeholder="Building, floor or room" /></label>
        <label className="block space-y-2 text-sm font-medium">Existing location<select className={INPUT} value={label} disabled={busy} onChange={e => choose(e.target.value)}>
          <option value="">Choose a location</option>
          {rows.filter(r => r.label === label || r.label.toLowerCase().includes(search.toLowerCase())).map(r => <option key={r.label} value={r.label}>{r.label}{r.active ? "" : " (retired)"}</option>)}
        </select></label>
        {legacy ? <p className="text-sm text-ink-soft">This historical label is protected for compatibility. Use Add location to enter a confirmed building or room.</p> :
        <form className="space-y-3 rounded-2xl border border-line p-4" onSubmit={e => { e.preventDefault(); void save(mode); }}>
          <h3 className="font-semibold">{mode === "create" ? "Add a confirmed location" : "Edit location name"}</h3>
          <p className="text-sm text-ink-soft">Add the building first, then its floor, then its rooms. Confirm details with the university. Renaming creates corrected choices for this location and its children, then retires the old paths. Historical reports keep their recorded text.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {([["Building / area", building, setBuilding], ["Floor (optional)", floor, setFloor], ["Room / facility (optional)", room, setRoom]] as const).map(([title, value, change], index) =>
              <label key={title} htmlFor={formId + index} className="block space-y-2 text-sm font-medium">{title}<input id={formId + index} className={INPUT} value={value} onChange={e => change(e.target.value)} disabled={busy || !editable} maxLength={80} /></label>)}
          </div>
          <p className="break-words text-sm text-ink-soft">{target || "Enter a location"} · {target.length}/80</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={BTN.gold} disabled={busy || !editable || invalid || (mode === "rename" && (!selected || target === label))}>Save location</button>
            {selected && <button type="button" className={BTN.ghost} disabled={busy || !editable} onClick={() => void save("availability")}>{selected.active ? "Retire selection" : "Restore selection"}</button>}
          </div>
        </form>}
        <p role="status" className="text-sm text-ink-soft">{message}</p>
      </div>
    </AdminModal>}
  </section>;
}
