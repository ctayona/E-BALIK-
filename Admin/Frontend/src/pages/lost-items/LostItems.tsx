import { useEffect, useState } from "react";
import { LostItem, lostItems as initialItems } from "../../data/mockData";
import { createAdminLostItem, deleteAdminLostItem, fetchAdminLostItems, getStoredAdmin, reportAdminProcess, updateAdminLostItem, type AdminLostItemRow } from "../../utils/api";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { showInfoModal } from "../../components/info-modal/infoModalStore";

const categories = ["All Categories", "Electronics", "Bags", "Documents", "Personal Items", "School Supplies", "Clothing"];
const locations = ["All Locations", "Library", "Gymnasium", "Cafeteria", "Admin Building", "Oval Track", "Engineering Building"];

function StatusBadge({ status }: { status: LostItem["status"] }) {
  const map: Record<LostItem["status"], { bg: string; text: string; dot: string }> = {
    "Potential Match": { bg: "#f5f3ff", text: "#7c3aed", dot: "#7c3aed" },
    "Searching": { bg: "#eff6ff", text: "#2563eb", dot: "#2563eb" },
    "Resolved": { bg: "#ecfdf5", text: "#059669", dot: "#10b981" },
    "Expired": { bg: "#fef2f2", text: "#dc2626", dot: "#ef4444" },
  };
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: s.bg, color: s.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }}></span>
      {status}
    </span>
  );
}

function AiBar({ value }: { value: number | null }) {
  if (!value) return <span className="text-slate-300">—</span>;
  const color = value >= 85 ? "#10b981" : value >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-sm font-semibold" style={{ color }}>{value}%</span>
    </div>
  );
}

interface ModalProps {
  item?: LostItem;
  onClose: () => void;
  onSave: (data: Omit<LostItem, "id" | "aiMatch" | "status">) => void;
}

type PendingAction =
  | { type: "save"; data: Omit<LostItem, "id" | "aiMatch" | "status">; reference?: string }
  | { type: "delete"; reference: string };

function mapLostItems(data: AdminLostItemRow[]): LostItem[] {
  return data.map((item) => ({
    id: item.id,
    item: item.item,
    description: item.description,
    category: item.category,
    location: item.location,
    dateLost: item.dateLost,
    reportedBy: item.reportedBy,
    studentId: item.studentId,
    photo: item.photo,
    aiMatch: item.aiMatch,
    status: item.status,
  }));
}

function ItemModal({ item, onClose, onSave }: ModalProps) {
  const [form, setForm] = useState({
    item: item?.item ?? "",
    description: item?.description ?? "",
    category: item?.category ?? "Electronics",
    location: item?.location ?? "",
    dateLost: item?.dateLost ?? "",
    reportedBy: item?.reportedBy ?? "",
    studentId: item?.studentId ?? "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-900">{item ? "Edit Lost Item" : "Add Lost Item"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Item Name *</label>
              <input value={form.item} onChange={e => set("item", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" placeholder="e.g. iPhone 13" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Category *</label>
              <select value={form.category} onChange={e => set("category", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20 bg-white">
                {categories.slice(1).map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Description</label>
            <input value={form.description} onChange={e => set("description", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" placeholder="Color, brand, distinguishing features" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Location Lost *</label>
              <select value={form.location} onChange={e => set("location", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20 bg-white">
                <option value="">Select location</option>
                {locations.slice(1).map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Date Lost *</label>
              <input type="date" value={form.dateLost} onChange={e => set("dateLost", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Reported By *</label>
              <input value={form.reportedBy} onChange={e => set("reportedBy", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" placeholder="Full name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Student ID *</label>
              <input value={form.studentId} onChange={e => set("studentId", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" placeholder="YYYY-NNNNN" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-line rounded-lg hover:bg-navy-50 transition-colors">Cancel</button>
          <button
            onClick={() => {
              if (!form.item || !form.category || !form.location || !form.dateLost || !form.reportedBy || !form.studentId) {
                reportAdminProcess({ success: false, title: "Save lost item", message: "Complete all required fields before saving this report." });
                return;
              }
              onSave(form);
            }}
            className="px-5 py-2 text-sm text-white rounded-lg font-semibold transition-colors"
            style={{ background: "#1f3160" }}
          >
            {item ? "Save Changes" : "Add Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LostItems() {
  const [items, setItems] = useState<LostItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [location, setLocation] = useState("All Locations");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<LostItem | undefined>();
  const [viewItem, setViewItem] = useState<LostItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const isSuperAdmin = getStoredAdmin()?.access_level === "super_admin";

  useEffect(() => {
    let active = true;
    fetchAdminLostItems()
      .then((data) => {
        if (!active) return;
        setItems(mapLostItems(data));
      })
      .catch(() => {
        setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    localStorage.setItem("e-balik-lost-items", JSON.stringify(items));
  }, [items]);

  const filtered = items.filter(it => {
    const q = search.toLowerCase();
    const matchQ = !q || it.item.toLowerCase().includes(q) || it.id.toLowerCase().includes(q) || it.reportedBy.toLowerCase().includes(q);
    const matchCat = category === "All Categories" || it.category === category;
    const matchLoc = location === "All Locations" || it.location === location;
    return matchQ && matchCat && matchLoc;
  });

  const confirmPendingAction = async () => {
    if (!pendingAction || actionBusy) return;
    setActionBusy(true);
    try {
      if (pendingAction.type === "delete") {
        await deleteAdminLostItem(pendingAction.reference);
      } else if (pendingAction.reference) {
        await updateAdminLostItem(pendingAction.reference, pendingAction.data);
      } else {
        await createAdminLostItem(pendingAction.data);
      }
      setItems(mapLostItems(await fetchAdminLostItems()));
      if (pendingAction.type === "save") {
        setShowModal(false);
        setEditItem(undefined);
      }
      setPendingAction(null);
    } catch (error) {
      showInfoModal({ variant: "error", title: "Changes not saved", message: error instanceof Error ? error.message : "Unable to save item changes.", replaceAuto: true });
      setPendingAction(null);
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return <div className="p-6 space-y-5" aria-busy="true"><div><SkeletonBlock className="mb-2 h-7 w-56" /><SkeletonBlock className="h-4 w-40" /></div><div className="rounded-xl border border-line bg-white p-4"><SkeletonBlock className="h-10 w-full" /></div><AdminTableSkeleton columns={9} rows={7} /></div>;
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lost Items Registry</h1>
          <p className="text-sm text-slate-500">{items.length} total records</p>
        </div>
        <button onClick={() => { setEditItem(undefined); setShowModal(true); }} className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-lg shadow-sm transition-opacity hover:opacity-90" style={{ background: "#1f3160" }}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
          Add Lost Item
        </button>
      </div>


      {/* Filters */}
      <div className="bg-white rounded-2xl border border-line shadow-card p-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-2.5 text-slate-400" width="15" height="15" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="m21 21-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item name, ID, student..." className="w-full pl-9 pr-3 py-2 text-sm border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-600/20" />
        </div>
        <select value={category} onChange={e => setCategory(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20 bg-white">
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={location} onChange={e => setLocation(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20 bg-white">
          {locations.map(l => <option key={l}>{l}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-line shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {["ITEM ID", "PHOTO", "ITEM", "CATEGORY", "LOCATION", "DATE LOST", "REPORTED BY", "STATUS", "ACTIONS"].map(h => (
                <th key={h} className="text-left px-4 py-3.5 text-xs font-semibold text-slate-400 tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-slate-400">No items found</td></tr>
            ) : filtered.map((it) => (
              <tr key={it.id} className="border-b border-line hover:bg-navy-50 transition-colors">
                <td className="px-4 py-3.5 text-xs text-slate-400 font-mono">{it.id}</td>
                <td className="px-4 py-3.5">
                  {it.photo ? (
                    <img src={it.photo} alt={`${it.item} preview`} className="h-10 w-10 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                      <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="m21 15-5-5L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <div className="font-semibold text-slate-900">{it.item}</div>
                  <div className="text-xs text-slate-400">{it.description}</div>
                </td>
                <td className="px-4 py-3.5 text-slate-600">{it.category}</td>
                <td className="px-4 py-3.5 text-slate-600">{it.location}</td>
                <td className="px-4 py-3.5 text-slate-600">{it.dateLost}</td>
                <td className="px-4 py-3.5">
                  <div className="font-medium text-slate-800">{it.reportedBy}</div>
                  <div className="text-xs text-slate-400">{it.studentId}</div>
                </td>
                <td className="px-4 py-3.5"><StatusBadge status={it.status} /></td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setViewItem(it)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" title="View">
                      <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/></svg>
                    </button>
                    <button onClick={() => { setEditItem(it); setShowModal(true); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-500 transition-colors" title="Edit">
                      <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </button>
                    {isSuperAdmin && <button onClick={() => setPendingAction({ type: "delete", reference: it.id })} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-500 transition-colors" title="Delete">
                      <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-line text-sm text-slate-500">
          Showing {filtered.length} of {items.length} records
        </div>
      </div>

      {/* View modal */}
      {viewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs font-mono text-slate-400">{viewItem.id}</div>
                <h2 className="text-xl font-bold text-slate-900">{viewItem.item}</h2>
              </div>
              <button onClick={() => setViewItem(null)} className="text-slate-400 hover:text-slate-600">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[["Description", viewItem.description], ["Category", viewItem.category], ["Location", viewItem.location], ["Date Lost", viewItem.dateLost], ["Reported By", viewItem.reportedBy], ["Student ID", viewItem.studentId]].map(([k, v]) => (
                <div key={k} className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-400 font-semibold mb-0.5">{k}</div>
                  <div className="font-medium text-slate-800">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              {viewItem.aiMatch && <AiBar value={viewItem.aiMatch} />}
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <ItemModal
          item={editItem}
          onClose={() => { setShowModal(false); setEditItem(undefined); }}
          onSave={(data) => setPendingAction({ type: "save", data, reference: editItem?.id })}
        />
      )}
      {pendingAction && <ConfirmActionDialog
        title={pendingAction.type === "delete" ? "delete this lost item" : pendingAction.reference ? "save these lost-item changes" : "create this lost-item record"}
        description={pendingAction.type === "delete" ? `This permanently deletes ${pendingAction.reference} from the database.` : "The change will be saved to the shared item registry."}
        confirmLabel={pendingAction.type === "delete" ? "Delete item" : "Confirm"}
        danger={pendingAction.type === "delete"}
        busy={actionBusy}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />}
    </div>
  );
}
