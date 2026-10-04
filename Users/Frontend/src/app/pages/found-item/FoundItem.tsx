import { useEffect, useId, useMemo, useRef, useState } from "react";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { ArrowLeft, CalendarRange, ChevronDown, Clock3, ImagePlus, MapPin, PackageSearch, ShieldCheck, Tag, Upload } from "lucide-react";
import { useAuth } from "@/app/utils/useAuth";
import { CX } from "@/app/utils/clay";
import type { Page } from "@/app/types";
import { ReportListSkeleton } from "@/app/shared/LoadingSkeleton";

const CATEGORIES = ["Bags & Luggage", "Electronics", "Accessories", "Personal Effects", "Documents & Cards", "Clothing", "Keys", "Valuables", "Others"];
const FOUND_LOCATIONS = ["Main Building Lobby", "Student Center", "Library", "ICT Building", "Faculty Hall", "Cafeteria", "Gym", "Other"];
const TURNOVER_LOCATIONS = ["Main Security Office", "Main Building Security Desk", "Student Center Security Desk", "Library Security Desk", "Gym Security Desk", "Other Security Post"];

type Report = {
  fpost_id: string;
  item_name: string;
  category: string;
  description?: string;
  location: string;
  found_date: string;
  image_url?: string;
  reporter_email?: string;
  reporter_campus_id?: string;
  turnover_location: string;
  guard_name_or_id: string;
  status: string;
};

type MatchSummary = {
  matched_above_55: number;
  matched_below_54: number;
  total_matches: number;
};

export default function FoundItem({ focused = false, onBack }: { focused?: boolean; onBack?: (page: Page) => void }) {
  const { createFoundItem, getFoundItems, getFoundMatchSummaries, isLoading, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"intake" | "reports">("intake");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState(FOUND_LOCATIONS[0]);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [dateFound, setDateFound] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [distinctiveMarks, setDistinctiveMarks] = useState("");
  const [turnoverLocation, setTurnoverLocation] = useState(TURNOVER_LOCATIONS[0]);
  const [guardNameOrId, setGuardNameOrId] = useState("");
  const [image, setImage] = useState<File | undefined>();
  const [imagePreview, setImagePreview] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [agreed, setAgreed] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [matchSummaries, setMatchSummaries] = useState<Record<string, MatchSummary>>({});
  const [reportSearch, setReportSearch] = useState("");
  const [reportCategory, setReportCategory] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [reportLocation, setReportLocation] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const filteredReports = useMemo(() => {
    const query = reportSearch.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesQuery = !query || [report.fpost_id, report.item_name, report.description, report.location, report.guard_name_or_id].some((value) => (value || "").toLowerCase().includes(query));
      const matchesCategory = !reportCategory || report.category === reportCategory;
      const matchesStatus = !reportStatus || report.status === reportStatus;
      const matchesLocation = !reportLocation || report.location.toLowerCase().includes(reportLocation.toLowerCase());
      return matchesQuery && matchesCategory && matchesStatus && matchesLocation;
    });
  }, [reports, reportSearch, reportCategory, reportStatus, reportLocation]);

  useEffect(() => {
    if (!confirmationOpen || countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [confirmationOpen, countdown]);

  async function loadReports() {
    setReportsLoading(true);
    try {
      const result = await getFoundItems();
      if (!result.success) showInfoModal({ variant: "error", title: "Could not load your reports", message: result.error || "Unable to load your reports." });
      else {
        setReports((result.items || []) as Report[]);
        const matches = await getFoundMatchSummaries();
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
    setCountdown(5);
    setAgreed(false);
    setConfirmationOpen(true);
  }

  async function confirmSubmit() {
    if (!agreed || countdown > 0) return;
    const result = await createFoundItem({
      item_name: title,
      category,
      description: [description, distinctiveMarks && `Distinctive marks: ${distinctiveMarks}`].filter(Boolean).join("\n\n"),
      location,
      found_date: dateFound,
      turnover_location: turnoverLocation,
      guard_name_or_id: guardNameOrId,
      image,
    });
    setConfirmationOpen(false);
    if (!result.success) {
      showInfoModal({ variant: "error", title: "Found report not published", message: result.error || "Unable to save found item report." });
      return;
    }
    const created = (result.item || null) as Report | null;
    showInfoModal({
      variant: "success",
      title: "Found report published",
      message: "Thank you. The report is recorded and the item is logged as turned over for safekeeping. Owners can now match against it.",
      reference: created?.fpost_id,
      details: [`Turned over at ${turnoverLocation}${guardNameOrId ? ` to ${guardNameOrId}` : ""}.`],
    });
    setTitle("");
    setDescription("");
    setDistinctiveMarks("");
    setGuardNameOrId("");
    setImage(undefined);
    setImagePreview("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function switchTab(tab: "intake" | "reports") {
    setActiveTab(tab);
    if (tab === "reports") void loadReports();
  }

  if (!focused && activeTab === "reports" && reportsLoading) {
    return <main className="flex-1 min-h-screen bg-page p-6 md:p-10"><div className="mx-auto max-w-[980px] space-y-5"><div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" /><ReportListSkeleton count={5} /></div></main>;
  }

  return (
    <div className="flex-1 min-h-screen bg-page p-6 md:p-10">
      <div className="mx-auto max-w-[980px]">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex size-[52px] items-center justify-center rounded-[16px] bg-navy-800 text-gold-300 border">
            <PackageSearch size={22} />
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-gold-700">Found items</p>
            <h1 className="text-[26px] font-semibold text-navy-800" style={{ fontFamily: 'var(--font-heading)' }}>Secure item reporting</h1>
          </div>
        </div>

        {!focused && <div className="mb-5 flex gap-1 rounded-2xl border border-line bg-white p-1.5">
          <button type="button" onClick={() => switchTab("intake")} className={`flex-1 rounded-[12px] px-4 py-3 text-[13px] font-bold transition-colors duration-200 ${activeTab === "intake" ? "bg-navy-800 hover:bg-navy-700 text-white border" : "text-ink-soft hover:bg-slate-100"}`}>Found Item Intake</button>
          <button type="button" onClick={() => switchTab("reports")} className={`flex-1 rounded-[12px] px-4 py-3 text-[13px] font-bold transition-colors duration-200 ${activeTab === "reports" ? "bg-navy-800 hover:bg-navy-700 text-white border" : "text-ink-soft hover:bg-slate-100"}`}>My Found Reports</button>
        </div>}
        {focused && <button type="button" onClick={() => onBack?.("report-item")} className="mb-5 inline-flex items-center gap-2 rounded-xl border border-line-strong bg-white px-4 py-2.5 text-[13px] font-bold text-navy-800 transition-colors"><ArrowLeft size={14} /> Back to report choices</button>}

        {error && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{error}</div>}

        {focused || activeTab === "intake" ? (
          <form onSubmit={handleSubmit} className="overflow-hidden rounded-2xl border border-line bg-white">
            <div className="border-b border-line/60 bg-slate-50 px-6 py-5"><p className="text-[14px] text-ink-soft">Reporter: <span className="font-bold text-navy-800">{user?.email}</span> · {user?.campus_id || "Campus ID unavailable"}</p><p className="mt-1 text-[12px] text-ink-muted">The account identity above is recorded automatically and cannot be edited.</p></div>
            <div className="grid gap-6 p-6 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block font-semibold text-[14px] text-ink">Item image</label>
                <div onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectImage(event.dataTransfer.files[0]); }} className="flex min-h-[170px] cursor-pointer items-center justify-center rounded-[12px] border-2 border-dashed border-gold-400 bg-gold-50 p-4">
                  {imagePreview ? <img src={imagePreview} alt="Found item preview" className="max-h-[210px] rounded-[9px] object-contain" /> : <div className="text-center text-ink-muted"><ImagePlus className="mx-auto mb-2 text-[#d1a153]" size={30} /><p className="text-[13px] font-semibold">Upload an image of the found item</p><p className="mt-1 text-[12px]">The image is stored in the found-item-images bucket.</p></div>}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => selectImage(event.target.files?.[0])} />
                <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 inline-flex items-center gap-2 text-[12px] font-semibold text-navy-800"><Upload size={14} /> Choose image</button>
              </div>

              <Field label="Item title / short description" value={title} onChange={setTitle} placeholder="Blue backpack with red zipper" required />
              <SelectField label="Category" value={category} onChange={setCategory} options={CATEGORIES} />
              <SelectField label="Where was it found?" value={location} onChange={setLocation} options={FOUND_LOCATIONS} icon={<MapPin size={15} />} />
              <Field label="Date found" value={dateFound} onChange={setDateFound} type="date" icon={<CalendarRange size={15} />} required />
              <div className="md:col-span-2"><TextAreaField label="Description / identifying details" value={description} onChange={setDescription} placeholder="Brand, color, size, and visible details." /></div>
              <div className="md:col-span-2"><TextAreaField label="Distinctive marks / proof-of-ownership notes" value={distinctiveMarks} onChange={setDistinctiveMarks} placeholder="Keep private marks useful for later claim verification." icon={<Tag size={15} />} /></div>

              <div className="md:col-span-2 rounded-[12px] border border-amber-200 bg-amber-50 p-5">
                <div className="flex items-start gap-3"><ShieldCheck size={20} className="mt-0.5 text-gold-700" /><div><p className="font-bold text-navy-800">Turn over the item to security guard personnel</p><p className="mt-1 text-[12px] text-ink-muted">The report status is controlled by the system. Record where and to whom the item was handed over.</p></div></div>
                <div className="mt-4 grid gap-4 md:grid-cols-2"><SelectField label="Security guard location" value={turnoverLocation} onChange={setTurnoverLocation} options={TURNOVER_LOCATIONS} /><Field label="Guard name or ID number" value={guardNameOrId} onChange={setGuardNameOrId} placeholder="Guard Santos / SG-014" required /></div>
              </div>
            </div>
            <div className="flex justify-end border-t border-line/60 bg-slate-50 px-6 py-4"><button type="submit" disabled={isLoading} className="inline-flex items-center gap-2 rounded-xl border bg-navy-800 hover:bg-navy-700 text-gold-300 px-6 py-3 text-[14px] font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed">{isLoading ? "Saving…" : "Publish Found Report"}</button></div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-4">
              <input value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Search ID, item, guard..." className="h-[42px] rounded-[8px] border border-line px-3 text-[13px] md:col-span-2" />
              <select value={reportCategory} onChange={(event) => setReportCategory(event.target.value)} className="h-[42px] rounded-[8px] border border-line bg-white px-3 text-[13px]"><option value="">All types</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
              <select value={reportStatus} onChange={(event) => setReportStatus(event.target.value)} className="h-[42px] rounded-[8px] border border-line bg-white px-3 text-[13px]"><option value="">All statuses</option><option value="unclaimed">Unclaimed</option><option value="claimed">Claimed</option><option value="returned">Returned</option></select>
              <input value={reportLocation} onChange={(event) => setReportLocation(event.target.value)} placeholder="Filter location..." className="h-[42px] rounded-[8px] border border-line px-3 text-[13px] md:col-span-2" />
            </div>
            <div className="max-h-[610px] space-y-4 overflow-y-auto pr-1">{filteredReports.length === 0 ? <div className="rounded-2xl border border-dashed border-line-strong bg-white p-10 text-center text-[14px] text-ink-muted">No found reports match these filters.</div> : filteredReports.map((report) => { const summary = matchSummaries[report.fpost_id] || { matched_above_55: 0, matched_below_54: 0, total_matches: 0 }; return <article key={report.fpost_id} className="overflow-hidden rounded-[16px] border border-line bg-white shadow-sm"><div className="flex flex-col gap-4 p-5 md:flex-row">{report.image_url ? <img src={report.image_url} alt={report.item_name} className="h-[130px] w-full rounded-[10px] object-cover md:w-[170px]" /> : <div className="flex h-[130px] w-full items-center justify-center rounded-[10px] bg-slate-50 text-[12px] text-slate-500 md:w-[170px]">No image</div>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[18px] font-semibold text-navy-800">{report.item_name}</p><div className="flex items-center gap-2"><span className="rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-bold text-emerald-700">{report.status || "unclaimed"}</span><span className="rounded-full bg-[#eef4ff] px-3 py-1 text-[12px] font-bold text-navy-800">{report.fpost_id}</span></div></div><p className="mt-1 text-[12px] text-ink-muted">{report.category} · Found {report.found_date} · {report.location}</p><p className="mt-3 whitespace-pre-line text-[13px] text-ink-soft">{report.description || "No description provided."}</p><div className="mt-4 grid gap-2 text-[12px] text-ink-soft md:grid-cols-2"><p><span className="font-bold text-navy-800">Turned over at:</span> {report.turnover_location}</p><p><span className="font-bold text-navy-800">Guard:</span> {report.guard_name_or_id}</p><p><span className="font-bold text-navy-800">Reporter:</span> {report.reporter_email}</p><p><span className="font-bold text-navy-800">Campus ID:</span> {report.reporter_campus_id}</p></div><div className="mt-4 grid grid-cols-3 gap-2 rounded-[10px] bg-slate-50 p-3 text-center text-[12px]"><div><p className="text-[20px] font-semibold text-emerald-700">{summary.matched_above_55}</p><p className="font-semibold text-ink-soft">55%+ matched</p></div><div><p className="text-[20px] font-semibold text-gold-700">{summary.matched_below_54}</p><p className="font-semibold text-ink-soft">54% or lower</p></div><div><p className="text-[20px] font-semibold text-navy-800">{summary.total_matches}</p><p className="font-semibold text-ink-soft">Total matches</p></div></div></div></div></article>; })}</div>
          </div>
        )}

        {confirmationOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/55 px-4 backdrop-blur-[4px]"><div className="w-full max-w-lg rounded-2xl border border-line bg-white p-8"><div className="flex items-center gap-3 mb-4"><div className="flex size-[48px] items-center justify-center rounded-[16px] bg-amber-50 text-amber-700 border border-amber-300/50"><ShieldCheck size={22} /></div><div><p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-gold-700">Authenticity confirmation</p><h2 className="text-[22px] font-semibold text-navy-800" style={{ fontFamily: 'var(--font-heading)' }}>Confirm this found report</h2></div></div><p className="text-[14px] leading-6 text-ink-soft mb-4">I understand that this report must be valid and authentic. False, fraudulent, or intentionally misleading reports may be subject to disciplinary or legal action under applicable university rules.</p><div className="rounded-xl border border-blue-200 bg-tide-50 px-4 py-3 text-[13px] text-blue-700 mb-4"><Clock3 className="mr-2 inline text-blue-500" size={14} />Please review carefully. Confirmation unlocks in <span className="font-bold text-blue-800">{countdown} seconds</span>.</div><label className={`flex items-start gap-3 text-[13px] ${countdown > 0 ? "text-slate-500" : "text-navy-800"} mb-5 cursor-pointer`}><input type="checkbox" disabled={countdown > 0} checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-0.5 size-4 accent-navy-800 cursor-pointer" />I agree that the information submitted is truthful and that the item has been turned over as recorded.</label><div className="flex justify-end gap-3"><button type="button" onClick={() => setConfirmationOpen(false)} className="rounded-xl border border-line-strong bg-white px-5 py-2.5 text-[13px] font-bold text-navy-800 transition-colors">Cancel</button><button type="button" disabled={!agreed || countdown > 0 || isLoading} onClick={() => void confirmSubmit()} className="rounded-xl border bg-navy-800 hover:bg-navy-700 px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50 transition-colors">{isLoading ? "Publishing…" : "Confirm and Publish"}</button></div></div></div>}
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
