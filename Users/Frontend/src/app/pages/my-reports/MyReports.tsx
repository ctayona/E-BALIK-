import { useEffect, useId, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, FileStack, GitCompareArrows, Layers, MapPin, Pencil, ShieldCheck, Tag, Trash2, Search, AlertTriangle, Plus, RefreshCw, QrCode } from "lucide-react";
import type { NavigationOptions, Page } from "@/app/types";
import { useAuth } from "@/app/utils/useAuth";
import { isCompletedReport, reportStatusLabel } from "@/app/utils/reportLifecycle";
import { CX } from "@/app/utils/clay";
import { ReportGridSkeleton } from "@/app/shared/LoadingSkeleton";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import ItemCollection from "@/app/shared/media/ItemCollection";
import ItemImage, { type GalleryItem } from "@/app/shared/media/ItemImage";
import ViewToggle from "@/app/shared/view/ViewToggle";
import { useViewMode } from "@/app/shared/view/useViewMode";
import Modal, { CountdownConsent } from "@/app/shared/modal/Modal";

type Report = {
  id: string; name: string; category?: string; description?: string;
  location: string; date: string; image?: string; status: string;
  kind: "Missing" | "Found"; distinctive_marks?: string; turnover_location?: string;
};
type Filter = "all" | "missing" | "found" | "completed";

const toGallery = (report: Report): GalleryItem => ({
  id: report.id, title: report.name, kind: report.kind === "Found" ? "found" : "missing", image: report.image || undefined,
  category: report.category, location: report.location, date: report.date, description: report.description,
  heldAt: report.turnover_location, status: reportStatusLabel(report.kind, report.status),
});

function StatusPill({ status }: { status: string }) {
  const value = (status || "").toLowerCase();
  const tone = value === "completed"
    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
    : ["unclaimed", "active", "missing"].includes(value)
      ? "bg-white/95 text-navy-800 ring-line"
      : "bg-amber-50 text-amber-800 ring-amber-200";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ${tone}`}>{status || "unknown"}</span>;
}

export default function MyReports({ onNavigate, highlightId, initialTab }: { onNavigate: (page: Page, options?: NavigationOptions) => void; highlightId?: string; initialTab?: Filter }) {
  const { getFoundItems, getMissingItems, updateFoundItem, updateMissingItem, deleteFoundItem, deleteMissingItem } = useAuth();
  const [mode] = useViewMode();
  const formId = useId();

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Filter>(initialTab === "completed" ? "completed" : "all");
  const [selected, setSelected] = useState<Report | null>(null);
  const [draft, setDraft] = useState<Report | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [confirmCountdown, setConfirmCountdown] = useState(5);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

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
      const m = (missing.items || []).map((item: any): Report => ({
        id: item.mpost_id, name: item.item_name, category: item.category, description: item.description,
        distinctive_marks: item.distinctive_marks, location: item.last_location, date: item.last_seen_date,
        image: item.image_url, status: item.status || "missing", kind: "Missing",
      }));
      const f = (found.items || []).map((item: any): Report => ({
        id: item.fpost_id, name: item.item_name, category: item.category, description: item.description,
        location: item.location, date: item.found_date, image: item.image_url,
        status: item.status || "unclaimed", turnover_location: item.turnover_location, kind: "Found",
      }));
      // Newest first by date, except a report that was just submitted: it always leads, so it is the first thing the reporter sees.
      setReports([...m, ...f].sort((a, b) => (Number(b.id === highlightId) - Number(a.id === highlightId)) || (new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadReports(); }, [getFoundItems, getMissingItems, highlightId]);

  function openReport(report: Report) {
    setSelected(report);
    setDraft({ ...report });
    setEditing(false);
  }

  function saveReport() {
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

  // Finished reports (the item was released to its owner) live in the Completed tab; the other tabs only show reports still in progress.
  const finished = useMemo(() => reports.filter((r) => isCompletedReport(r.kind, r.status)), [reports]);
  const inProgress = useMemo(() => reports.filter((r) => !isCompletedReport(r.kind, r.status)), [reports]);
  const counts = useMemo(() => ({
    all: inProgress.length,
    missing: inProgress.filter((r) => r.kind === "Missing").length,
    found: inProgress.filter((r) => r.kind === "Found").length,
    completed: finished.length,
  }), [inProgress, finished]);
  const visibleReports = useMemo(() => {
    const pool = active === "completed" ? finished : inProgress.filter((r) => active === "all" || r.kind.toLowerCase() === active);
    const needle = query.trim().toLowerCase();
    if (!needle) return pool;
    return pool.filter((r) => [r.name, r.id, r.category, r.location, r.description].some((part) => String(part || "").toLowerCase().includes(needle)));
  }, [finished, inProgress, active, query]);
  // Reports made by marking a Smart Tag as lost carry the tag's code in their private marks.
  const fromTag = (report: Report) => /^smart tag\b/i.test(report.distinctive_marks || "");

  async function refresh() {
    setRefreshing(true);
    await loadReports();
    setRefreshing(false);
  }
  const selectedCompleted = Boolean(selected && isCompletedReport(selected.kind, selected.status));
  const visibleGallery = useMemo(() => visibleReports.map(toGallery), [visibleReports]);
  const confirming = (confirmDelete || confirmEdit) && Boolean(selected);

  return (
    <main className={CX.page}>
      <div className={CX.inner}>
        {/* Header */}
        <header className="relative mb-6 overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#22366a_0%,#162448_62%,#0e1830_100%)] p-5 text-white shadow-[0_24px_60px_-34px_rgba(14,24,48,0.9)] sm:p-7">
          <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-[radial-gradient(circle,rgba(209,161,83,0.38),transparent_68%)]" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-gold-300">Personal workspace</p>
              <h1 className="mt-1 font-[family-name:var(--font-heading)] text-[28px] font-semibold leading-tight sm:text-[34px]">My reports</h1>
              <p className="mt-1.5 max-w-[56ch] text-[14.5px] leading-6 text-navy-100">Everything you've reported, in one place. Open a report to review, edit or remove it.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onNavigate("matches")} className="inline-flex min-h-[46px] items-center gap-2 rounded-2xl bg-white/10 px-4 text-[14px] font-semibold text-white ring-1 ring-white/20 transition-colors hover:bg-white/15">
                <GitCompareArrows size={16} aria-hidden="true" /> View matches
              </button>
              <button type="button" onClick={() => onNavigate("report-item")} className="inline-flex min-h-[46px] items-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#ecc787,#d1a153)] px-4 text-[14px] font-semibold text-navy-950 shadow-[0_10px_22px_-12px_rgba(209,161,83,0.95)] transition-transform active:scale-[0.98]">
                <Plus size={16} aria-hidden="true" /> New report
              </button>
            </div>
          </div>
        </header>

        <dl className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {([
            { label: "In progress", tab: "all", value: counts.all, icon: FileStack, tone: "bg-iris-50 text-iris-600" },
            { label: "Missing", tab: "missing", value: counts.missing, icon: Search, tone: "bg-tide-50 text-tide-700" },
            { label: "Found", tab: "found", value: counts.found, icon: ShieldCheck, tone: "bg-gold-50 text-gold-700" },
            { label: "Completed", tab: "completed", value: counts.completed, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          ] as const).map(({ label, tab, value, icon: Icon, tone }) => (
            <button
              key={label}
              type="button"
              onClick={() => setActive(tab)}
              aria-pressed={active === tab}
              className={`${CX.card} flex min-h-[64px] items-center gap-3 p-3 text-left transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 active:scale-[0.99] sm:p-4 ${active === tab ? "ring-2 ring-gold-400/70" : ""}`}
            >
              <span className={`hidden size-11 shrink-0 items-center justify-center rounded-2xl sm:flex ${tone}`}><Icon size={19} aria-hidden="true" /></span>
              <div className="min-w-0">
                <dt className="truncate text-[12px] font-medium text-ink-muted sm:text-[13px]">{label}</dt>
                <dd className="font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight tabular-nums text-ink sm:text-[26px]">{loading ? "–" : value}</dd>
              </div>
            </button>
          ))}
        </dl>

        {/* Filters + view */}
        <div className="glass sticky top-[calc(var(--app-header-h)+12px+env(safe-area-inset-top))] z-20 mb-5 flex items-center justify-between gap-2 rounded-[20px] p-2">
          <div role="tablist" aria-label="Report type" className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto">
            {(["all", "missing", "found", "completed"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active === tab}
                onClick={() => setActive(tab)}
                className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[14px] font-semibold transition-colors sm:px-4 ${
                  active === tab ? "bg-[linear-gradient(180deg,#2b4282_0%,#1f3160_100%)] text-white shadow-[0_8px_18px_-10px_rgba(17,27,66,0.8)]" : "text-ink-soft hover:bg-white/80"
                }`}
              >
                {tab === "all" ? "All" : tab === "missing" ? "Missing" : tab === "found" ? "Found" : "Completed"}
                <span className={`rounded-full px-1.5 text-[12px] tabular-nums ${active === tab ? "bg-white/20" : "bg-frost-100 text-ink-muted"}`}>{counts[tab]}</span>
              </button>
            ))}
          </div>
          <ViewToggle compact />
        </div>

        <div className="mb-4 flex items-center gap-2">
          <div role="search" className="relative min-w-0 flex-1">
            <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <label htmlFor="my-reports-search" className="sr-only">Search my reports</label>
            <input
              id="my-reports-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by item, place or reference"
              autoComplete="off"
              enterKeyHint="search"
              className={`${CX.input} h-12 w-full pl-10`}
            />
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading || refreshing} aria-label="Refresh my reports" className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-line bg-white/80 text-ink-soft transition-colors hover:border-iris-300 hover:text-iris-700 disabled:opacity-60">
            <RefreshCw size={17} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
          </button>
        </div>

        {query.trim() && !loading && <p className="mb-3 text-[13px] text-ink-muted" aria-live="polite">{visibleReports.length} {visibleReports.length === 1 ? "report matches" : "reports match"} "{query.trim()}".</p>}

        {loading ? <ReportGridSkeleton count={4} /> : (
          <ItemCollection
            label="My reports"
            items={visibleGallery}
            highlightId={highlightId}
            mode={mode}
            onOpen={(_item, index) => openReport(visibleReports[index])}
            badge={(item) => {
              const report = visibleReports.find((r) => r.id === item.id);
              return (
                <span className="inline-flex flex-col items-end gap-1 sm:flex-row sm:items-center">
                  {report && fromTag(report) && <span className="inline-flex items-center gap-1 rounded-full bg-gold-50 px-2 py-1 text-[11px] font-semibold text-gold-800 ring-1 ring-gold-200"><QrCode size={11} aria-hidden="true" /><span className="hidden sm:inline">Smart Tag</span><span className="sr-only sm:hidden">Smart Tag</span></span>}
                  <StatusPill status={item.status || ""} />
                </span>
              );
            }}
            empty={query.trim() ? (
              <div className="glass flex flex-col items-center gap-3 rounded-[22px] px-6 py-14 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-frost-100 text-iris-600"><Search size={26} aria-hidden="true" /></span>
                <p className="text-[16px] font-semibold text-ink">Nothing matches your search</p>
                <p className="max-w-[44ch] text-[14px] text-ink-muted">Try a different word, or clear the search to see every report in this tab.</p>
                <button type="button" onClick={() => setQuery("")} className={CX.btnGhost}>Clear search</button>
              </div>
            ) : active === "completed" ? (
              <div className="glass flex flex-col items-center gap-3 rounded-[22px] px-6 py-14 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><CheckCircle2 size={26} aria-hidden="true" /></span>
                <p className="text-[16px] font-semibold text-ink">Nothing completed yet</p>
                <p className="max-w-[44ch] text-[14px] text-ink-muted">When an item is released to its owner, the lost and found reports about it move here.</p>
              </div>
            ) : (
              <div className="glass flex flex-col items-center gap-3 rounded-[22px] px-6 py-14 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-frost-100 text-iris-600"><FileStack size={26} aria-hidden="true" /></span>
                <p className="text-[16px] font-semibold text-ink">No reports in this view yet</p>
                <p className="max-w-[44ch] text-[14px] text-ink-muted">Reports you submit for found or lost items will appear here.</p>
                <button type="button" onClick={() => onNavigate("report-item")} className={CX.btnGold}>Report an item</button>
              </div>
            )}
          />
        )}
      </div>

      {/* Detail / edit modal */}
      <Modal
        open={Boolean(selected) && !confirming}
        onClose={() => setSelected(null)}
        size="lg"
        tone={selected?.kind === "Found" ? "gold" : "mint"}
        icon={editing ? <Pencil size={20} /> : selected?.kind === "Found" ? <ShieldCheck size={21} /> : <Search size={21} />}
        eyebrow={selected ? `${selected.kind} report · ${selected.id}` : undefined}
        title={editing ? "Edit report" : selected?.name}
        description={editing ? "Update the details below. Matching refreshes automatically after you save." : undefined}
        hero={!editing && selected?.image ? (
          <div className="relative">
            <ItemImage item={toGallery(selected)} className="h-[200px] w-full sm:h-[240px]" />
            <span className="absolute bottom-3 left-3"><StatusPill status={reportStatusLabel(selected.kind, selected.status)} /></span>
          </div>
        ) : undefined}
        footer={editing ? (
          <>
            <button type="button" onClick={() => setEditing(false)} className={CX.btnGhost}>Cancel</button>
            <button type="submit" form={formId} disabled={saving} className={CX.btnNavy}>{saving ? "Saving…" : "Save changes"}</button>
          </>
        ) : selectedCompleted ? (
          <button type="button" onClick={() => setSelected(null)} className={CX.btnNavy}>Close</button>
        ) : (
          <>
            <button type="button" onClick={openDeleteConfirmation} className={`${CX.btnGhost} border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 sm:mr-auto`}>
              <Trash2 size={15} aria-hidden="true" /> Delete
            </button>
            {selected?.kind === "Missing" && (
              <button type="button" onClick={() => { const id = selected.id; setSelected(null); onNavigate("matches", { reportId: id }); }} className={CX.btnGhost}>
                <GitCompareArrows size={15} aria-hidden="true" /> Matches
              </button>
            )}
            <button type="button" onClick={() => setEditing(true)} className={CX.btnNavy}>
              <Pencil size={15} aria-hidden="true" /> Edit report
            </button>
          </>
        )}
      >
        {selected && draft && (editing ? (
          <form id={formId} onSubmit={(event) => { event.preventDefault(); saveReport(); }} className="grid gap-4 sm:grid-cols-2">
            {([
              ["Item name", "name", "text"],
              ["Category", "category", "text"],
              [selected.kind === "Found" ? "Where it was found" : "Last seen at", "location", "text"],
              [selected.kind === "Found" ? "Date found" : "Date lost", "date", "date"],
            ] as const).map(([label, key, type]) => (
              <div key={key}>
                <label htmlFor={`${formId}-${key}`} className={CX.label}>{label}</label>
                <input
                  id={`${formId}-${key}`}
                  type={type}
                  required={key === "name" || key === "date"}
                  value={(draft[key] as string) || ""}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className={`${CX.input} w-full`}
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label htmlFor={`${formId}-description`} className={CX.label}>Description</label>
              <textarea id={`${formId}-description`} value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={4} className={`${CX.input} w-full resize-y py-3 leading-6`} />
            </div>
            {selected.kind === "Missing" && (
              <div className="sm:col-span-2">
                <label htmlFor={`${formId}-marks`} className={CX.label}>Private distinctive marks</label>
                <textarea id={`${formId}-marks`} value={draft.distinctive_marks || ""} onChange={(e) => setDraft({ ...draft, distinctive_marks: e.target.value })} rows={3} className={`${CX.input} w-full resize-y py-3 leading-6`} />
                <p className={CX.helper}>Only you and administrators can see these. They help verify ownership.</p>
              </div>
            )}
          </form>
        ) : (
          <div className="space-y-4">
            {selectedCompleted && (
              <p className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-[14px] leading-6 text-emerald-900">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                {selected.kind === "Found"
                  ? "Completed. This item reached its owner (or was sold and collected), so this report is closed. Thank you for turning it in."
                  : "Completed. The item was released to you, so this report is closed."}
              </p>
            )}
            {selected.description && <p className="whitespace-pre-line text-[15px] leading-7 text-ink-soft">{selected.description}</p>}
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: Layers, label: "Category", value: selected.category || "Not provided" },
                { icon: MapPin, label: selected.kind === "Found" ? "Found at" : "Last seen at", value: selected.location },
                { icon: CalendarDays, label: selected.kind === "Found" ? "Date found" : "Date lost", value: selected.date },
                ...(selected.turnover_location ? [{ icon: Tag, label: "Turned over at", value: selected.turnover_location }] : []),
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3 rounded-2xl border border-line bg-frost-50 p-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-iris-600 shadow-card"><Icon size={16} aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <dt className="text-[12px] font-medium text-ink-muted">{label}</dt>
                    <dd className="mt-0.5 break-words text-[15px] font-semibold text-ink">{value || "Not recorded"}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </Modal>

      {/* Confirmation modal */}
      <Modal
        open={confirming}
        onClose={() => { setConfirmDelete(false); setConfirmEdit(false); }}
        dismissible={!saving}
        size="sm"
        tone={confirmEdit ? "iris" : "danger"}
        icon={confirmEdit ? <Pencil size={20} /> : <AlertTriangle size={21} />}
        eyebrow={selected ? `${selected.kind} report · ${selected.id}` : undefined}
        title={confirmEdit ? "Confirm your changes" : "Delete this report?"}
        description={confirmEdit
          ? "Check that the updated information is accurate before saving."
          : `This permanently removes ${selected?.id ?? "this report"} and its photo. This can't be undone.`}
        footer={
          <>
            <button type="button" disabled={saving} onClick={() => { setConfirmDelete(false); setConfirmEdit(false); }} className={CX.btnGhost}>Cancel</button>
            <button
              type="button"
              onClick={() => void (confirmEdit ? confirmSaveReport() : removeReport())}
              disabled={!confirmChecked || confirmCountdown > 0 || saving}
              className={confirmEdit ? CX.btnNavy : CX.btnDanger}
            >
              {saving ? "Working…" : confirmEdit ? "Save changes" : "Delete report"}
            </button>
          </>
        }
      >
        <CountdownConsent
          countdown={confirmCountdown}
          checked={confirmChecked}
          onCheckedChange={setConfirmChecked}
          label="I confirm this action applies only to my own report."
        />
      </Modal>
    </main>
  );
}
