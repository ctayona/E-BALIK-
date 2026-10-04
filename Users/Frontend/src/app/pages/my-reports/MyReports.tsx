import { useEffect, useState } from "react";
import { GitCompareArrows, ImageOff, MapPin, Pencil, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { NavigationOptions, Page } from "@/app/types";
import { useAuth } from "@/app/utils/useAuth";
import { CX, SPRING } from "@/app/utils/clay";
import { ReportGridSkeleton } from "@/app/shared/LoadingSkeleton";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";

type Report = {
  id: string; name: string; category?: string; description?: string;
  location: string; date: string; image?: string; status: string;
  kind: "Missing" | "Found"; distinctive_marks?: string; turnover_location?: string;
};

function ReportThumb({ report }: { report: Report }) {
  const [failed, setFailed] = useState(false);
  if (!report.image || failed)
    return <div className="flex size-[72px] shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 border border-white/60"><ImageOff size={20} /></div>;
  return <img src={report.image} alt={report.name} className="size-[72px] shrink-0 rounded-xl object-cover border border-white/60" onError={() => setFailed(true)} />;
}

export default function MyReports({ onNavigate }: { onNavigate: (page: Page, options?: NavigationOptions) => void }) {
  const { getFoundItems, getMissingItems, updateFoundItem, updateMissingItem, deleteFoundItem, deleteMissingItem } = useAuth();

  // All state preserved exactly
  const [reports,           setReports]           = useState<Report[]>([]);
  const [loading,            setLoading]            = useState(true);
  const [active,            setActive]            = useState<"all" | "missing" | "found">("all");
  const [selected,          setSelected]          = useState<Report | null>(null);
  const [draft,             setDraft]             = useState<Report | null>(null);
  const [editing,           setEditing]           = useState(false);
  const [confirmDelete,     setConfirmDelete]     = useState(false);
  const [confirmEdit,       setConfirmEdit]       = useState(false);
  const [confirmCountdown,  setConfirmCountdown]  = useState(5);
  const [confirmChecked,    setConfirmChecked]    = useState(false);
  const [saving,            setSaving]            = useState(false);

  // All logic preserved exactly
  useEffect(() => {
    if ((!confirmDelete && !confirmEdit) || confirmCountdown <= 0) return;
    const timer = window.setTimeout(() => setConfirmCountdown((v) => v - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete, confirmEdit, confirmCountdown]);

  useEffect(() => {
    if (!confirmDelete) return;
    setConfirmCountdown(5);
    setConfirmChecked(false);
  }, [confirmDelete]);

  async function loadReports() {
    setLoading(true);
    try {
      const [missing, found] = await Promise.all([getMissingItems(), getFoundItems()]);
      const m = (missing.items || []).map((item: any) => ({
        id: item.mpost_id, name: item.item_name, category: item.category, description: item.description,
        distinctive_marks: item.distinctive_marks, location: item.last_location, date: item.last_seen_date,
        image: item.image_url, status: item.status || "missing", kind: "Missing" as const,
      }));
      const f = (found.items || []).map((item: any) => ({
        id: item.fpost_id, name: item.item_name, category: item.category, description: item.description,
        location: item.location, date: item.found_date, image: item.image_url,
        status: item.status || "unclaimed", turnover_location: item.turnover_location, kind: "Found" as const,
      }));
      setReports([...m, ...f]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadReports(); }, [getFoundItems, getMissingItems]);

  async function saveReport() {
    if (!draft) return;
    setConfirmCountdown(5); setConfirmChecked(false); setConfirmEdit(true);
  }
  async function confirmSaveReport() {
    if (!draft || !confirmChecked || confirmCountdown > 0) return;
    setSaving(true);
    const data = draft.kind === "Found"
      ? { item_name: draft.name, category: draft.category || "", description: draft.description || "", location: draft.location, found_date: draft.date }
      : { item_name: draft.name, category: draft.category || "", description: draft.description || "", distinctive_marks: draft.distinctive_marks || "", last_location: draft.location, last_seen_date: draft.date };
    const result = draft.kind === "Found" ? await updateFoundItem(draft.id, data) : await updateMissingItem(draft.id, data);
    setSaving(false);
    if (!result.success) {
      setConfirmEdit(false);
      showInfoModal({ variant: "error", title: "Changes not saved", message: result.error || "Unable to update report." });
      return;
    }
    showInfoModal({ variant: "success", title: "Report updated", message: `Your changes to "${draft.name}" are saved and matching has been refreshed.`, reference: draft.id });
    setEditing(false); setSelected(null); setConfirmEdit(false); await loadReports();
  }
  async function removeReport() {
    if (!selected || !confirmChecked || confirmCountdown > 0) return;
    setSaving(true);
    const result = selected.kind === "Found" ? await deleteFoundItem(selected.id) : await deleteMissingItem(selected.id);
    setSaving(false);
    if (!result.success) {
      setConfirmDelete(false);
      showInfoModal({ variant: "error", title: "Report not deleted", message: result.error || "Unable to delete report." });
      return;
    }
    showInfoModal({ variant: "success", title: "Report deleted", message: `"${selected.name}" was removed from your reports and will no longer appear in matching.`, reference: selected.id });
    setConfirmDelete(false); setSelected(null); await loadReports();
  }
  function openDeleteConfirmation() { setConfirmCountdown(5); setConfirmChecked(false); setConfirmDelete(true); }

  const visibleReports = reports.filter((r) => active === "all" || r.kind.toLowerCase() === active);

  return (
    <main className={CX.page}>
      <div className={CX.inner}>

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
        >
          <div>
            <span className={CX.sectionLabel}>Personal Workspace</span>
            <h1 className="mt-1 text-[30px] font-semibold text-navy-800 tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
              My Reports
            </h1>
            <p className="mt-1 text-[14px] text-ink-muted">Manage every report submitted by your account.</p>
          </div>
          <motion.button
            type="button"
            onClick={() => onNavigate("matches")}
            whileHover={{ y: -2, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={SPRING}
            className={`${CX.btnNavy} flex items-center gap-2 px-5 py-3 text-[13px]`}
          >
            <GitCompareArrows size={15} /> View Matches
          </motion.button>
        </motion.div>


        {/* Filter tabs */}
        <div className={`${CX.cardSm} flex gap-1 p-1.5 mb-6`}>
          {(["all", "missing", "found"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActive(tab)}
              className={`flex-1 rounded-[12px] py-2.5 text-[13px] font-bold transition-colors duration-200 capitalize ${
                active === tab
                  ? "bg-navy-800 hover:bg-navy-700 text-white border"
                  : "text-ink-soft hover:bg-slate-100"
              }`}
            >
              {tab === "all" ? "All Reports" : tab === "missing" ? "Missing Items" : "Found Items"}
            </button>
          ))}
        </div>

        {/* Report grid */}
        {loading ? <ReportGridSkeleton count={4} /> : <div className="grid gap-4 sm:grid-cols-2">
          {visibleReports.length === 0 ? (
            <div className={`${CX.card} col-span-full py-16 text-center flex flex-col items-center gap-3`}>
              <div className="size-[56px] flex items-center justify-center rounded-2xl bg-slate-100 border border-white/60 text-slate-500">
                <ImageOff size={24} />
              </div>
              <p className="text-[16px] font-bold text-ink-muted">No reports in this view yet.</p>
            </div>
          ) : visibleReports.map((report) => (
            <motion.button
              type="button"
              key={`${report.kind}-${report.id}`}
              onClick={() => { setSelected(report); setDraft({ ...report }); setEditing(false); }}
              whileHover={{ y: -4, scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              transition={SPRING}
              className={`${CX.card} text-left overflow-hidden cursor-pointer`}
            >
              <div className="flex gap-3 p-4">
                <ReportThumb report={report} />
                <div className="min-w-0 flex-1">
                  <span className={report.kind === "Found" ? CX.badgeGold : CX.badgeRed}>
                    {report.kind} report
                  </span>
                  <h2 className="mt-2 truncate text-[15px] font-semibold text-navy-800">{report.name}</h2>
                  <p className="mt-1 flex items-center gap-1.5 truncate text-[12px] text-ink-muted">
                    <MapPin size={11} className="shrink-0 text-[#d1a153]" />{report.location}
                  </p>
                  <p className="mt-0.5 text-[12px] text-slate-500">{report.date}</p>
                  <p className="mt-2 text-[12px] font-bold capitalize text-navy-800">{report.status}</p>
                </div>
              </div>
              <div className="border-t border-[#eef2f7] px-4 py-2.5 text-[12px] font-bold text-navy-800 text-right bg-slate-50/50">
                Open report details →
              </div>
            </motion.button>
          ))}
        </div>}

        {/* ── Report detail modal ── */}
        <AnimatePresence>
          {selected && (
            <motion.div
              key="detail-overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/55 px-4 backdrop-blur-[4px]"
              onClick={() => setSelected(null)}
            >
              <motion.div
                initial={{ scale: 0.88, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 16 }}
                transition={SPRING}
                onClick={(e) => e.stopPropagation()}
                className={`${CX.modal} w-full max-w-2xl max-h-[90vh] overflow-y-auto gap-5
                            [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.5)_transparent]`}
              >
                {/* Header */}
                <div className="flex items-center justify-between gap-4 w-full">
                  <div>
                    <span className={selected.kind === "Found" ? CX.badgeGold : CX.badgeRed}>
                      {selected.kind} report · {selected.id}
                    </span>
                    <h2 className="mt-2 text-[24px] font-semibold text-navy-800" style={{ fontFamily: "var(--font-heading)" }}>
                      {editing ? "Edit report" : selected.name}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:text-navy-800 hover:bg-slate-100 transition-colors shrink-0"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Image */}
                {selected.image && (
                  <div className="w-full rounded-2xl overflow-hidden border border-white/60">
                    <img src={selected.image} alt={selected.name} className="h-[220px] w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  </div>
                )}

                <div className={CX.divider} />

                {/* Edit form or view */}
                {editing && draft ? (
                  <div className="grid gap-4 md:grid-cols-2 w-full">
                    {([ ["Item name","name"],["Category","category"],["Location","location"],[selected.kind === "Found" ? "Found date" : "Last seen date","date"] ] as [string,string][]).map(([label, key]) => (
                      <label key={key} className="flex flex-col gap-2 text-[13px] font-bold text-navy-800">
                        {label}
                        <input
                          type={key === "date" ? "date" : "text"}
                          value={(draft as any)[key] || ""}
                          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                          className={`${CX.input} h-[46px] w-full`}
                        />
                      </label>
                    ))}
                    <label className="flex flex-col gap-2 text-[13px] font-bold text-navy-800 md:col-span-2">
                      Description
                      <textarea
                        value={draft.description || ""}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        className="rounded-xl border border-line-strong bg-slate-50 p-3 text-[14px] font-normal text-ink outline-none focus:border-navy-600 transition-colors"
                        rows={4}
                      />
                    </label>
                    {selected.kind === "Missing" && (
                      <label className="flex flex-col gap-2 text-[13px] font-bold text-navy-800 md:col-span-2">
                        Private distinctive marks
                        <textarea
                          value={draft.distinctive_marks || ""}
                          onChange={(e) => setDraft({ ...draft, distinctive_marks: e.target.value })}
                          className="rounded-xl border border-line-strong bg-slate-50 p-3 text-[14px] font-normal text-ink outline-none focus:border-navy-600 transition-colors"
                          rows={3}
                        />
                      </label>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-3 text-[14px] text-ink-soft md:grid-cols-2 w-full">
                    {[
                      { label: "Category",  value: selected.category  || "Not provided" },
                      { label: "Status",    value: selected.status },
                      { label: "Location",  value: selected.location },
                      { label: "Date",      value: selected.date },
                      ...(selected.description    ? [{ label: "Description",   value: selected.description }] : []),
                      ...(selected.turnover_location ? [{ label: "Turned over at", value: selected.turnover_location }] : []),
                    ].map(({ label, value }) => (
                      <div key={label} className={`${CX.cardSm} p-3 ${label === "Description" || label === "Turned over at" ? "md:col-span-2" : ""}`}>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-gold-700">{label}</p>
                        <p className="mt-1 text-[14px] font-semibold text-navy-800">{value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap justify-between gap-3 pt-3 border-t border-line w-full">
                  {editing ? (
                    <>
                      <button type="button" onClick={() => setEditing(false)} className={`${CX.btnGhost} px-5 py-2.5 text-[13px]`}>
                        Cancel
                      </button>
                      <button type="button" onClick={() => void saveReport()} disabled={saving} className={`${CX.btnNavy} px-5 py-2.5 text-[13px]`}>
                        {saving ? "Saving…" : "Save changes"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setEditing(true)} className={`${CX.btnGhost} flex items-center gap-2 px-5 py-2.5 text-[13px]`}>
                        <Pencil size={13} /> Edit report
                      </button>
                      <button type="button" onClick={openDeleteConfirmation} className={`${CX.btnDanger} flex items-center gap-2 px-5 py-2.5 text-[13px]`}>
                        <Trash2 size={13} /> Delete report
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Confirm delete / edit modal ── */}
        <AnimatePresence>
          {(confirmDelete || confirmEdit) && selected && (
            <motion.div
              key="confirm-overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/55 px-4 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.88, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 16 }}
                transition={SPRING}
                className={`${CX.modal} w-full max-w-md gap-4`}
              >
                <div className={`size-[48px] flex items-center justify-center rounded-[16px] ${confirmEdit ? "bg-blue-200 text-blue-600" : "bg-red-200 text-red-600"} border ${confirmEdit ? "border-blue-300/50" : "border-red-300/50"} `}>
                  <Pencil size={20} />
                </div>
                <h2 className="text-[20px] font-semibold text-navy-800" style={{ fontFamily: "var(--font-heading)" }}>
                  {confirmEdit ? "Confirm report changes" : "Delete this report?"}
                </h2>
                <p className="text-[14px] text-ink-muted">
                  {confirmEdit
                    ? "Please verify that the updated information is accurate before saving."
                    : `This permanently removes ${selected.id}. This action cannot be undone.`}
                </p>
                <div className={CX.alertInfo}>
                  Confirmation unlocks in <strong className="text-blue-700">{confirmCountdown} seconds</strong>.
                </div>
                <label className="flex items-start gap-3 text-[13px] text-ink-soft cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={confirmCountdown > 0}
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                    className="mt-0.5 size-4 accent-navy-800 cursor-pointer"
                  />
                  I confirm this action applies only to my own report.
                </label>
                <div className="flex justify-end gap-3 w-full">
                  <button
                    type="button"
                    onClick={() => { setConfirmDelete(false); setConfirmEdit(false); }}
                    className={`${CX.btnGhost} px-5 py-2.5 text-[13px]`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void (confirmEdit ? confirmSaveReport() : removeReport())}
                    disabled={!confirmChecked || confirmCountdown > 0 || saving}
                    className={`${confirmEdit ? CX.btnNavy : CX.btnDanger} px-5 py-2.5 text-[13px]`}
                  >
                    {saving ? "Working…" : confirmEdit ? "Save changes" : "Delete report"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </main>
  );
}