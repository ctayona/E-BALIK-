import { ImagePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { FoundItem, foundItems as initialItems } from "../../data/mockData";
import { createAdminFoundItem, deleteAdminFoundItem, fetchAdminFoundItems, getStoredAdmin, reportAdminProcess, updateAdminFoundItem, type AdminFoundItemRow } from "../../utils/api";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { showInfoModal } from "../../components/info-modal/infoModalStore";

const statuses = ["All Statuses", "Claimed", "Unclaimed", "Released"];

function StatusBadge({ status }: { status: FoundItem["status"] }) {
  const map: Record<FoundItem["status"], { bg: string; text: string; dot: string }> = {
    "Ready to Release": { bg: "#ecfdf5", text: "#059669", dot: "#10b981" },
    "Under Review": { bg: "#fffbeb", text: "#d97706", dot: "#f59e0b" },
    "Released": { bg: "#eff6ff", text: "#2563eb", dot: "#3b82f6" },
    "Claimed": { bg: "#ecfdf5", text: "#059669", dot: "#10b981" },
    "Unclaimed": { bg: "#fef2f2", text: "#dc2626", dot: "#ef4444" },
  };
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: s.bg, color: s.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }}></span>
      {status}
    </span>
  );
}

interface RegisterModalProps {
  item?: FoundItem;
  onClose: () => void;
  onSave: (data: Omit<FoundItem, "id" | "aiStatus" | "aiPercent" | "status">) => void;
}

type FoundItemForm = Omit<FoundItem, "id" | "aiStatus" | "aiPercent" | "status">;
type PendingAction =
  | { type: "save"; data: FoundItemForm; reference?: string }
  | { type: "delete"; reference: string };

function mapFoundItems(data: AdminFoundItemRow[]): FoundItem[] {
  return data.map((item) => ({
    id: item.id,
    item: item.item,
    description: item.description,
    category: item.category,
    locationFound: item.locationFound,
    dateFound: item.dateFound,
    storage: item.storage,
    aiStatus: item.aiStatus,
    aiPercent: item.aiPercent,
    matchedItem: item.matchedItem,
    status: item.status,
    photo: item.photo,
  }));
}

function RegisterModal({ item, onClose, onSave }: RegisterModalProps) {
  const [form, setForm] = useState({
    item: item?.item ?? "",
    description: item?.description ?? "",
    category: item?.category ?? "Electronics",
    locationFound: item?.locationFound ?? "",
    dateFound: item?.dateFound ?? "",
    storage: item?.storage ?? "",
    photo: item?.photo ?? "",
  });
  const [aiRunning, setAiRunning] = useState(false);
  const [aiComplete, setAiComplete] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const uploadPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      reportAdminProcess({ success: false, title: "Upload item photo", message: "Please upload a PNG or JPG image." });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reportAdminProcess({ success: false, title: "Upload item photo", message: "The image must be smaller than 10 MB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("photo", String(reader.result));
    reader.readAsDataURL(file);
    setAiComplete(false);
  };

  const runRecognition = () => {
    if (!form.photo) return;
    setAiRunning(true);
    window.setTimeout(() => {
      setAiRunning(false);
      setAiComplete(true);
    }, 700);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-900">{item ? "Edit Found Item" : "Register Found Item"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">AI Visual Recognition</label>
            <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); uploadPhoto(e.dataTransfer.files[0]); }} className={`flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-3 text-center transition-colors ${form.photo ? "border-tide-200 bg-tide-50/40" : "border-gray-300 bg-slate-50 hover:border-tide-500 hover:bg-tide-50/30"}`}>
              <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={e => uploadPhoto(e.target.files?.[0])} />
              {form.photo ? (
                <img src={form.photo} alt="Found item preview" className="h-24 max-w-full rounded-lg object-contain" />
              ) : (
                <>
                  <svg width="24" height="24" fill="none" viewBox="0 0 24 24" className="mb-1 text-slate-300"><path d="M12 16V4m0 0L8 8m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span className="text-xs text-slate-600">Drop photos here or click to upload</span>
                  <span className="mt-1 text-[12px] text-slate-400">PNG, JPG up to 10MB each</span>
                </>
              )}
            </label>
            <button type="button" disabled={!form.photo || aiRunning} onClick={runRecognition} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50" style={{ background: "#7c3aed" }}>
              <ImagePlus size={16} aria-hidden="true" />
              {aiRunning ? "Analyzing photo..." : aiComplete ? "AI Recognition Complete" : "Run AI Recognition"}
            </button>
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800">
              <span className="font-bold">Note:</span> AI recognition assists in categorization but does not automatically verify ownership. Admin review is required.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Item Name *</label>
              <input value={form.item} onChange={e => set("item", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" placeholder="e.g. iPhone 13" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Category *</label>
              <select value={form.category} onChange={e => set("category", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-600/20">
                {["Electronics","Bags","Documents","Personal Items","School Supplies","Clothing"].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Description</label>
            <input value={form.description} onChange={e => set("description", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" placeholder="Color, brand, condition..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Location Found *</label>
              <input value={form.locationFound} onChange={e => set("locationFound", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" placeholder="Building — specific area" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Date Found *</label>
              <input type="date" value={form.dateFound} onChange={e => set("dateFound", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Storage Location *</label>
            <input value={form.storage} onChange={e => set("storage", e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" placeholder="e.g. Admin Locker A-12" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-line rounded-lg hover:bg-navy-50">Cancel</button>
          <button
            onClick={() => {
              if (!form.item || !form.category || !form.locationFound || !form.dateFound || !form.storage) {
                reportAdminProcess({ success: false, title: "Save found item", message: "Complete all required fields before saving this record." });
                return;
              }
              onSave(form);
            }}
            className="px-5 py-2 text-sm text-white rounded-lg font-semibold hover:opacity-90 transition-opacity"
            style={{ background: "#0f8077" }}
          >
            {item ? "Save Changes" : "Register Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FoundItems() {
  const [items, setItems] = useState<FoundItem[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All Statuses");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<FoundItem | undefined>();
  const [viewItem, setViewItem] = useState<FoundItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const isSuperAdmin = getStoredAdmin()?.access_level === "super_admin";

  useEffect(() => {
    let active = true;
    fetchAdminFoundItems()
      .then((data) => {
        if (!active) return;
        setItems(mapFoundItems(data));
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
    localStorage.setItem("e-balik-found-items", JSON.stringify(items));
  }, [items]);

  const filtered = items.filter(it => {
    const q = search.toLowerCase();
    const matchesSearch = !q || it.item.toLowerCase().includes(q) || it.id.toLowerCase().includes(q) || it.locationFound.toLowerCase().includes(q);
    const matchesStatus = status === "All Statuses" || it.status === status;
    return matchesSearch && matchesStatus;
  });

  const confirmPendingAction = async () => {
    if (!pendingAction || actionBusy) return;
    setActionBusy(true);
    try {
      if (pendingAction.type === "delete") {
        await deleteAdminFoundItem(pendingAction.reference);
      } else if (pendingAction.reference) {
        await updateAdminFoundItem(pendingAction.reference, pendingAction.data);
      } else {
        await createAdminFoundItem(pendingAction.data);
      }
      setItems(mapFoundItems(await fetchAdminFoundItems()));
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
          <h1 className="text-2xl font-bold text-slate-900">Found Items Registry</h1>
          <p className="text-sm text-slate-500">{items.filter(i => i.status !== "Released").length} items currently in custody · record collection from the approved claim to close related reports</p>
        </div>
        <button onClick={() => { setEditItem(undefined); setShowModal(true); }} className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-lg shadow-sm hover:opacity-90 transition-opacity" style={{ background: "#0f8077" }}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
          Register Found Item
        </button>
      </div>


      <div className="bg-white rounded-2xl border border-line shadow-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-[3]">
          <svg className="absolute left-3 top-2.5 text-slate-400" width="15" height="15" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="m21 21-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item or ID..." className="w-full pl-9 pr-3 py-2 text-sm border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-600/20" />
          </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="w-40 flex-none border border-line rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-600/20">
          {statuses.map(option => <option key={option}>{option}</option>)}
        </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-line shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {["ITEM ID","PHOTO","ITEM","CATEGORY","LOCATION FOUND","DATE FOUND","STORAGE","STATUS","ACTIONS"].map(h => (
                <th key={h} className="text-left px-4 py-3.5 text-xs font-semibold text-slate-400 tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-slate-400">No items found</td></tr>
            ) : filtered.map(it => (
              <tr key={it.id} className="border-b border-line hover:bg-navy-50 transition-colors">
                <td className="px-4 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">{it.id}</td>
                <td className="px-4 py-3">
                  {it.photo ? (
                    <img src={it.photo} alt={`${it.item} photo`} className="h-10 w-10 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                      <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="m21 15-5-5L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{it.item}</div>
                  <div className="text-xs text-slate-400 max-w-36 truncate">{it.description}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{it.category}</td>
                <td className="px-4 py-3 text-slate-600">{it.locationFound}</td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{it.dateFound}</td>
                <td className="px-4 py-3 text-slate-600">{it.storage}</td>
                <td className="px-4 py-3"><StatusBadge status={it.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setViewItem(it)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="View">
                      <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/></svg>
                    </button>
                    <button onClick={() => { setEditItem(it); setShowModal(true); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-500" title="Edit">
                      <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </button>
                    {isSuperAdmin && <button onClick={() => setPendingAction({ type: "delete", reference: it.id })} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-500" title="Delete">
                      <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
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
              {[ ["Description", viewItem.description], ["Category", viewItem.category], ["Location Found", viewItem.locationFound], ["Date Found", viewItem.dateFound], ["Storage", viewItem.storage], ["AI Status", viewItem.aiPercent ? (viewItem.matchedItem ? `Matched with ${viewItem.matchedItem} (${viewItem.aiPercent}%)` : `Matched (${viewItem.aiPercent}%)`) : "No Match"] ].map(([k, v]) => (
                <div key={String(k)} className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-400 font-semibold mb-0.5">{String(k)}</div>
                  <div className="font-medium text-slate-800">{String(v)}</div>
                </div>
              ))}
            </div>
            {viewItem.photo && (
              <img src={viewItem.photo} alt={`${viewItem.item} preview`} className="mt-4 h-48 w-full rounded-xl bg-slate-50 object-contain" />
            )}
            <div className="mt-4"><StatusBadge status={viewItem.status} /></div>
          </div>
        </div>
      )}

      {showModal && (
        <RegisterModal
          item={editItem}
          onClose={() => { setShowModal(false); setEditItem(undefined); }}
          onSave={(data) => setPendingAction({ type: "save", data, reference: editItem?.id })}
        />
      )}
      {pendingAction && <ConfirmActionDialog
        title={pendingAction.type === "delete" ? "delete this found item" : pendingAction.reference ? "save these found-item changes" : "register this found item"}
        description={pendingAction.type === "delete" ? `This permanently deletes ${pendingAction.reference} and its linked claim records from the database.` : "The change will be saved to the shared item registry."}
        confirmLabel={pendingAction.type === "delete" ? "Delete item" : "Confirm"}
        danger={pendingAction.type === "delete"}
        busy={actionBusy}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />}
    </div>
  );
}
