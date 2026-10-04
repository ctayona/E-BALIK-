import { useEffect, useId, useMemo, useRef, useState } from "react";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { ArrowLeft, CalendarRange, ChevronDown, Clock3, Filter, ImagePlus, MapPin, PackageSearch, SearchCheck, ShieldCheck, Tag, Upload } from "lucide-react";
import { useAuth } from "@/app/utils/useAuth";
import { CX } from "@/app/utils/clay";
import type { Page } from "@/app/types";
import { ReportListSkeleton } from "@/app/shared/LoadingSkeleton";

const CATEGORIES = ["Bags & Luggage", "Electronics", "Accessories", "Personal Effects", "Documents & Cards", "Clothing", "Keys", "Valuables", "Others"];
const CAMPUS_LOCATIONS = ["Main Building Lobby", "Student Center", "Library", "ICT Building", "Faculty Hall", "Cafeteria", "Gym", "HPSB Building", "Other"];

type Report = {
  mpost_id: string;
  item_name: string;
  category: string;
  description?: string;
  distinctive_marks?: string;
  last_location: string;
  last_seen_date: string;
  image_url?: string;
  reporter_email?: string;
  reporter_campus_id?: string;
  status: string;
};

type FoundResult = {
  fpost_id: string;
  item_name: string;
  category: string;
  description?: string;
  location: string;
  found_date: string;
  image_url?: string;
  status: string;
  match_percentage: number;
};

type MatchSummary = {
  matched_above_55: number;
  matched_below_54: number;
  total_matches: number;
};

export default function MissingItem({ initialSearchTerm = "", focused = false, onBack }: { initialSearchTerm?: string; focused?: boolean; onBack?: (page: Page) => void }) {
  const { createMissingItem, getMissingItems, getMissingMatchSummaries, searchFoundItems, isLoading, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"intake" | "reports" | "search">("intake");
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [distinctiveMarks, setDistinctiveMarks] = useState("");
  const [lastLocation, setLastLocation] = useState(CAMPUS_LOCATIONS[0]);
  const [lastSeenDate, setLastSeenDate] = useState(new Date().toISOString().slice(0, 10));
  const [authorized, setAuthorized] = useState(false);
  const [image, setImage] = useState<File | undefined>();
  const [imagePreview, setImagePreview] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [agreed, setAgreed] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [matchSummaries, setMatchSummaries] = useState<Record<string, MatchSummary>>({});
  const [foundResults, setFoundResults] = useState<FoundResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCategory, setSearchCategory] = useState("");
  const [searchLocation, setSearchLocation] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [selectedReportId, setSelectedReportId] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportCategory, setReportCategory] = useState("");
  const [reportLocation, setReportLocation] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initialSearchTerm) return;
    let active = true;
    setActiveTab("search");
    setSearchQuery(initialSearchTerm);
    setResultsLoading(true);
    void searchFoundItems({ query: initialSearchTerm }).then((result) => {
      if (active && result.success) setFoundResults((result.items || []) as FoundResult[]);
    }).finally(() => { if (active) setResultsLoading(false); });
    return () => { active = false; };
  }, [initialSearchTerm, searchFoundItems]);

  const filteredReports = useMemo(() => {
    const query = reportSearch.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesQuery = !query || [report.mpost_id, report.item_name, report.description, report.last_location].some((value) => (value || "").toLowerCase().includes(query));
      const matchesCategory = !reportCategory || report.category === reportCategory;
      const matchesLocation = !reportLocation || report.last_location.toLowerCase().includes(reportLocation.toLowerCase());
      return matchesQuery && matchesCategory && matchesLocation;
    });
  }, [reports, reportSearch, reportCategory, reportLocation]);

  useEffect(() => {
    if (!confirmationOpen || countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [confirmationOpen, countdown]);

  async function loadReports() {
    setReportsLoading(true);
    try {
      const result = await getMissingItems();
      if (!result.success) showInfoModal({ variant: "error", title: "Could not load your reports", message: result.error || "Unable to load your missing reports." });
      else {
        setReports((result.items || []) as Report[]);
        const matches = await getMissingMatchSummaries();
        if (matches.success) setMatchSummaries(matches.summaries as Record<string, MatchSummary>);
      }
    } finally {
      setReportsLoading(false);
    }
  }

  function selectImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    setImage(file);
    setImagePreview(URL.createObjectURL(file));
    setError("");
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!authorized) {
      setError("Please authorize matching and notifications before continuing.");
      return;
    }
    setCountdown(5);
    setAgreed(false);
    setConfirmationOpen(true);
  }

  async function confirmSubmit() {
    if (!agreed || countdown > 0) return;
    const result = await createMissingItem({
      item_name: itemName,
      category,
      description,
      distinctive_marks: distinctiveMarks,
      last_location: lastLocation,
      last_seen_date: lastSeenDate,
      authorized,
      image,
    });
    setConfirmationOpen(false);
    if (!result.success) {
      showInfoModal({ variant: "error", title: "Missing report not saved", message: result.error || "Unable to save missing item report." });
      return;
    }
    const created = (result.item || null) as Report | null;
    showInfoModal({
      variant: "success",
      title: "Missing report is now active",
      message: "We'll compare it against every found item and notify you when a likely match appears.",
      reference: created?.mpost_id,
      details: ["Check Matches any time to review possible found items."],
    });
    setItemName("");
    setDescription("");
    setDistinctiveMarks("");
    setAuthorized(false);
    setImage(undefined);
    setImagePreview("");
    await loadReports();
  }

  async function searchReports() {
    const report = reports.find((item) => item.mpost_id === selectedReportId);
    setResultsLoading(true);
    try {
      const result = await searchFoundItems({
      query: searchQuery,
      category: searchCategory,
      location: searchLocation,
      found_date: searchDate,
      missing_item_name: report?.item_name || "",
      missing_category: report?.category || "",
      missing_description: report?.description || "",
      missing_distinctive_marks: report?.distinctive_marks || "",
      missing_location: report?.last_location || "",
      missing_date: report?.last_seen_date || "",
      });
      if (!result.success) showInfoModal({ variant: "error", title: "Search failed", message: result.error || "Unable to search found reports." });
      else setFoundResults((result.items || []) as FoundResult[]);
    } finally {
      setResultsLoading(false);
    }
  }

  async function loadRecentFoundReports() {
    setResultsLoading(true);
    try {
      const result = await searchFoundItems({});
      if (!result.success) showInfoModal({ variant: "error", title: "Could not load found reports", message: result.error || "Unable to load recent found reports." });
      else setFoundResults((result.items || []) as FoundResult[]);
    } finally {
      setResultsLoading(false);
    }
  }

  function switchTab(tab: "intake" | "reports" | "search") {
    setActiveTab(tab);
    if (tab === "reports") void loadReports();
    if (tab === "search") {
      void loadReports();
      void loadRecentFoundReports();
    }
  }

  if (!focused && activeTab === "reports" && reportsLoading) {
    return <div className="flex-1 bg-slate-100 p-6 md:p-10"><div className="mx-auto max-w-[980px] space-y-5"><div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" /><ReportListSkeleton count={5} /></div></div>;
  }

  if (activeTab === "search" && resultsLoading) {
    return <div className="flex-1 bg-slate-100 p-6 md:p-10"><div className="mx-auto max-w-[980px] space-y-5"><div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" /><ReportListSkeleton count={5} /></div></div>;
  }

  return (
    <div className="flex-1 bg-slate-100 p-6 md:p-10">
      <div className="mx-auto max-w-[980px]">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-[44px] items-center justify-center rounded-full bg-navy-800 text-[#d1a153]"><SearchCheck size={20} /></div>
          <div><p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#d1a153]">Missing items</p><h1 className="text-[27px] font-semibold text-navy-800">Find your item faster</h1></div>
        </div>

        {!focused && <div className="mb-5 flex gap-1 rounded-[12px] border border-line bg-white p-1">
          <button type="button" onClick={() => switchTab("intake")} className={`flex-1 rounded-[9px] px-4 py-3 text-[13px] font-bold ${activeTab === "intake" ? "bg-navy-800 text-white" : "text-ink-soft hover:bg-slate-50"}`}>Lookup Missing Items</button>
          <button type="button" onClick={() => switchTab("reports")} className={`flex-1 rounded-[9px] px-4 py-3 text-[13px] font-bold ${activeTab === "reports" ? "bg-navy-800 text-white" : "text-ink-soft hover:bg-slate-50"}`}>Missing Item Reports</button>
          <button type="button" onClick={() => switchTab("search")} className={`flex-1 rounded-[9px] px-4 py-3 text-[13px] font-bold ${activeTab === "search" ? "bg-navy-800 text-white" : "text-ink-soft hover:bg-slate-50"}`}>Search Found Reports</button>
        </div>}
        {focused && <button type="button" onClick={() => onBack?.("report-item")} className="mb-5 inline-flex items-center gap-2 rounded-[9px] border border-line-strong bg-white px-4 py-2 text-[13px] font-bold text-navy-800"><ArrowLeft size={15} /> Back to report choices</button>}

        {error && <div className="mb-5 rounded-[10px] border border-rose-200 bg-red-50 p-4 text-[13px] font-medium text-rose-800">{error}</div>}

        {focused || activeTab === "intake" ? (
          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <aside className="h-fit rounded-xl border border-dashed border-gold-400 bg-white p-5">
              <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-[#d1a153]" /><p className="font-bold uppercase tracking-[0.12em] text-[12px] text-[#d1a153]">Smart matching</p></div>
              <p className="mt-3 text-[13px] leading-5 text-ink-soft">Specific details help compare your report with found-item records while keeping private ownership clues away from public listings.</p>
              <div className="mt-5 space-y-3 border-t border-line pt-4 text-[12px] text-ink-soft"><p><span className="font-bold text-navy-800">1.</span> Add a clear item photo when available.</p><p><span className="font-bold text-navy-800">2.</span> Record the last known campus location and date.</p><p><span className="font-bold text-navy-800">3.</span> Keep unique marks specific for claim verification.</p></div>
            </aside>

            <form onSubmit={handleSubmit} className="overflow-hidden rounded-2xl border border-line bg-white">
              <div className="border-b border-line bg-slate-50 px-6 py-5"><p className="text-[14px] text-ink-soft">Reporter: <span className="font-semibold text-navy-800">{user?.email}</span> · {user?.campus_id || "Campus ID unavailable"}</p><p className="mt-1 text-[12px] text-ink-muted">Your account identity is attached automatically to this report.</p></div>
              <div className="grid gap-6 p-6 md:grid-cols-2">
                <div className="md:col-span-2"><label className="mb-2 block font-semibold text-[14px] text-ink">Item image / reference photo</label><div onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectImage(event.dataTransfer.files[0]); }} className="flex min-h-[165px] cursor-pointer items-center justify-center rounded-[12px] border-2 border-dashed border-gold-400 bg-gold-50 p-4">{imagePreview ? <img src={imagePreview} alt="Missing item preview" className="max-h-[210px] rounded-[9px] object-contain" /> : <div className="text-center text-ink-muted"><ImagePlus className="mx-auto mb-2 text-[#d1a153]" size={30} /><p className="text-[13px] font-semibold">Upload a photo of your item</p><p className="mt-1 text-[12px]">Stored securely in the missing-item-images bucket.</p></div>}</div><input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => selectImage(event.target.files?.[0])} /><button type="button" onClick={() => fileRef.current?.click()} className="mt-2 inline-flex items-center gap-2 text-[12px] font-semibold text-navy-800"><Upload size={14} /> Choose image</button></div>
                <Field label="Item name" value={itemName} onChange={setItemName} placeholder="Black leather wallet" required />
                <SelectField label="Category" value={category} onChange={setCategory} options={CATEGORIES} />
                <SelectField label="Last seen location" value={lastLocation} onChange={setLastLocation} options={CAMPUS_LOCATIONS} icon={<MapPin size={15} />} />
                <Field label="Last seen date" value={lastSeenDate} onChange={setLastSeenDate} type="date" icon={<CalendarRange size={15} />} required />
                <div className="md:col-span-2"><TextAreaField label="Description" value={description} onChange={setDescription} placeholder="Include brand, color, size, condition, and visible features." required /></div>
                <div className="md:col-span-2"><TextAreaField label="Private distinctive marks" value={distinctiveMarks} onChange={setDistinctiveMarks} placeholder="Optional: unique marks or contents to verify a future claim." icon={<Tag size={15} />} /></div>
                <label className="flex items-start gap-3 rounded-[11px] border border-[#dbe3f0] bg-slate-50 p-4 text-[13px] text-ink-soft md:col-span-2"><input type="checkbox" required checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} className="mt-0.5 size-4 accent-navy-800" />I authorize E-Balik to compare this report with found-item records and notify me about possible matches.</label>
              </div>
              <div className="flex justify-end border-t border-line bg-slate-50 px-6 py-4"><button type="submit" disabled={isLoading} className="inline-flex items-center gap-2 rounded-[10px] bg-navy-800 px-5 py-3 text-[14px] font-semibold text-[#d1a153] disabled:opacity-60">{isLoading ? "Saving..." : "Submit Missing Report"}</button></div>
            </form>
          </div>
        ) : activeTab === "reports" ? (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-4"><input value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Search ID, item, details..." className="h-[42px] rounded-[8px] border border-line px-3 text-[13px] md:col-span-2" /><select value={reportCategory} onChange={(event) => setReportCategory(event.target.value)} className="h-[42px] rounded-[8px] border border-line bg-white px-3 text-[13px]"><option value="">All types</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select><input value={reportLocation} onChange={(event) => setReportLocation(event.target.value)} placeholder="Filter last location..." className="h-[42px] rounded-[8px] border border-line px-3 text-[13px]" /></div>
            <div className="max-h-[610px] space-y-4 overflow-y-auto pr-1">{filteredReports.length === 0 ? <div className="rounded-2xl border border-dashed border-line-strong bg-white p-10 text-center text-[14px] text-ink-muted">No missing reports match these filters.</div> : filteredReports.map((report) => { const summary = matchSummaries[report.mpost_id] || { matched_above_55: 0, matched_below_54: 0, total_matches: 0 }; return <article key={report.mpost_id} className="overflow-hidden rounded-[16px] border border-line bg-white shadow-sm"><div className="flex flex-col gap-4 p-5 md:flex-row">{report.image_url ? <img src={report.image_url} alt={report.item_name} className="h-[140px] w-full rounded-[10px] object-cover md:w-[180px]" /> : <div className="flex h-[140px] w-full items-center justify-center rounded-[10px] bg-slate-50 text-[12px] text-slate-500 md:w-[180px]">No image</div>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[18px] font-semibold text-navy-800">{report.item_name}</p><div className="flex items-center gap-2"><span className="rounded-full bg-amber-50 px-3 py-1 text-[12px] font-bold text-gold-700">{report.status || "missing"}</span><span className="rounded-full bg-[#eef4ff] px-3 py-1 text-[12px] font-bold text-navy-800">{report.mpost_id}</span></div></div><p className="mt-1 text-[12px] text-ink-muted">{report.category} · Last seen {report.last_seen_date} · {report.last_location}</p><p className="mt-3 text-[13px] text-ink-soft">{report.description}</p><div className="mt-4 grid gap-2 text-[12px] text-ink-soft md:grid-cols-2"><p><span className="font-bold text-navy-800">Reporter:</span> {report.reporter_email}</p><p><span className="font-bold text-navy-800">Campus ID:</span> {report.reporter_campus_id}</p>{report.distinctive_marks && <p className="md:col-span-2"><span className="font-bold text-navy-800">Private marks:</span> {report.distinctive_marks}</p>}</div><div className="mt-4 grid grid-cols-3 gap-2 rounded-[10px] bg-slate-50 p-3 text-center text-[12px]"><div><p className="text-[20px] font-semibold text-emerald-700">{summary.matched_above_55}</p><p className="font-semibold text-ink-soft">55%+ matched</p></div><div><p className="text-[20px] font-semibold text-gold-700">{summary.matched_below_54}</p><p className="font-semibold text-ink-soft">54% or lower</p></div><div><p className="text-[20px] font-semibold text-navy-800">{summary.total_matches}</p><p className="font-semibold text-ink-soft">Total matches</p></div></div></div></div></article>; })}</div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2"><Filter size={18} className="text-[#d1a153]" /><h2 className="text-[18px] font-semibold text-navy-800">Find possible matches</h2></div>
              <p className="mt-1 text-[13px] text-ink-muted">Choose one of your missing reports to calculate a match percentage against unclaimed found reports.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <select value={selectedReportId} onChange={(event) => setSelectedReportId(event.target.value)} className="h-[44px] rounded-[8px] border border-line bg-white px-3 text-[13px] text-navy-800"><option value="">Select my missing report</option>{reports.map((report) => <option key={report.mpost_id} value={report.mpost_id}>{report.mpost_id} · {report.item_name}</option>)}</select>
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search item or details" className="h-[44px] rounded-[8px] border border-line px-3 text-[13px]" />
                <select value={searchCategory} onChange={(event) => setSearchCategory(event.target.value)} className="h-[44px] rounded-[8px] border border-line bg-white px-3 text-[13px]"><option value="">All types</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
                <input value={searchLocation} onChange={(event) => setSearchLocation(event.target.value)} placeholder="Location contains..." className="h-[44px] rounded-[8px] border border-line px-3 text-[13px]" />
                <input type="date" value={searchDate} onChange={(event) => setSearchDate(event.target.value)} className="h-[44px] rounded-[8px] border border-line px-3 text-[13px]" />
                <button type="button" onClick={() => void searchReports()} disabled={isLoading} className="h-[44px] rounded-[8px] bg-navy-800 text-[13px] font-bold text-white disabled:opacity-60">{isLoading ? "Searching..." : "Search Found Reports"}</button>
              </div>
            </div>
            <div className="max-h-[610px] space-y-3 overflow-y-auto pr-1">{foundResults.length === 0 ? <div className="rounded-[16px] border border-dashed border-line-strong bg-white p-8 text-center text-[13px] text-ink-muted">No matching found reports yet. Adjust your filters and search again.</div> : foundResults.slice(0, 5).map((item) => <article key={item.fpost_id} className="flex flex-col gap-4 rounded-[16px] border border-line bg-white p-4 shadow-sm md:flex-row">{item.image_url && <img src={item.image_url} alt={item.item_name} className="h-[130px] w-full rounded-[10px] object-cover md:w-[170px]" />}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[17px] font-semibold text-navy-800">{item.item_name}</h3><span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${item.match_percentage >= 70 ? "bg-emerald-50 text-emerald-700" : item.match_percentage >= 40 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{item.match_percentage}% match</span></div><p className="mt-1 text-[12px] text-ink-muted">{item.category} · {item.location} · {item.found_date} · {item.fpost_id}</p><p className="mt-3 text-[13px] text-ink-soft">{item.description || "No description provided."}</p></div></article>)}</div>
          </div>
        )}


        {confirmationOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center gap-3"><div className="rounded-full bg-amber-100 p-2 text-gold-700"><ShieldCheck size={20} /></div><div><p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-gold-700">Report confirmation</p><h2 className="mt-1 text-[22px] font-semibold text-navy-800">Confirm your missing-item report</h2></div></div><p className="mt-4 text-[14px] leading-6 text-ink-soft">Please confirm that the information is accurate. E-Balik will use this report for matching and notifications. False or misleading reports may be subject to university action.</p><div className="mt-4 rounded-[10px] bg-slate-50 p-3 text-[12px] text-ink-soft"><Clock3 className="mr-2 inline text-[#d1a153]" size={15} />Confirmation unlocks in <span className="font-bold text-navy-800">{countdown} seconds</span>.</div><label className={`mt-5 flex items-start gap-3 text-[13px] ${countdown > 0 ? "text-slate-500" : "text-navy-800"}`}><input type="checkbox" disabled={countdown > 0} checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-0.5 size-4 accent-navy-800" />I confirm that this missing-item report is truthful and belongs to me.</label><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setConfirmationOpen(false)} className="rounded-[9px] border border-line-strong px-4 py-2 text-[13px] font-semibold text-navy-800">Cancel</button><button type="button" disabled={!agreed || countdown > 0 || isLoading} onClick={() => void confirmSubmit()} className="rounded-[9px] bg-navy-800 px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{isLoading ? "Publishing..." : "Confirm and Publish"}</button></div></div></div>}
      </div>
    </div>
  );
}

function FieldLabel({ htmlFor, label, required, icon }: { htmlFor: string; label: string; required?: boolean; icon?: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1.5 text-[14px] font-semibold text-ink-soft">
      {icon && <span className="text-gold-600" aria-hidden="true">{icon}</span>}
      {label}
      {required && <span className="text-rose-600" aria-hidden="true">*</span>}
    </label>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", icon, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; icon?: React.ReactNode; required?: boolean }) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} required={required} icon={icon} />
      <input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} className={`${CX.input} w-full`} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, icon }: { label: string; value: string; onChange: (value: string) => void; options: string[]; icon?: React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} icon={icon} />
      <div className="relative">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={`${CX.input} w-full appearance-none pr-10`}>
          {options.map((option) => <option key={option}>{option}</option>)}
        </select>
        <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
      </div>
    </div>
  );
}

function TextAreaField({ label, value, onChange, placeholder, icon, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; icon?: React.ReactNode; required?: boolean }) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} required={required} icon={icon} />
      <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} rows={3} className={`${CX.input} w-full resize-y py-3 leading-6`} />
    </div>
  );
}
