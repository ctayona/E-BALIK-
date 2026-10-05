import { useEffect, useId, useMemo, useRef, useState } from "react";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarRange, ChevronDown, ClipboardList, FileStack, Filter, ImagePlus, Lightbulb, MapPin, RefreshCw, Search, SearchCheck, Tag, UserRound, X } from "lucide-react";
import { useAuth } from "@/app/utils/useAuth";
import { CX } from "@/app/utils/clay";
import type { NavigationOptions, Page } from "@/app/types";
import { ReportGridSkeleton } from "@/app/shared/LoadingSkeleton";
import ItemCollection from "@/app/shared/media/ItemCollection";
import ItemImage, { type GalleryItem } from "@/app/shared/media/ItemImage";
import ItemViewer from "@/app/shared/media/ItemViewer";
import ViewToggle from "@/app/shared/view/ViewToggle";
import { useViewMode } from "@/app/shared/view/useViewMode";
import Modal, { CountdownConsent } from "@/app/shared/modal/Modal";
import VerificationGate from "@/app/shared/verification/VerificationGate";
import { isVerified, useCurrentUser } from "@/app/utils/system";

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

export default function MissingItem({ initialSearchTerm = "", focused = false, onBack }: { initialSearchTerm?: string; focused?: boolean; onBack?: (page: Page, options?: NavigationOptions) => void }) {
  const { createMissingItem, getMissingItems, getMissingMatchSummaries, searchFoundItems, isLoading, user } = useAuth();
  const verified = isVerified(useCurrentUser());
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
  const [mode] = useViewMode();
  const [openReport, setOpenReport] = useState<Report | null>(null);
  const [resultIndex, setResultIndex] = useState<number | null>(null);

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

  const galleryReports = useMemo<GalleryItem[]>(() => filteredReports.map((report) => ({
    id: report.mpost_id, title: report.item_name, kind: "missing", image: report.image_url || undefined, category: report.category,
    location: report.last_location, date: report.last_seen_date, description: report.description, status: report.status,
  })), [filteredReports]);
  const galleryResults = useMemo<GalleryItem[]>(() => [...foundResults].sort((a, b) => b.match_percentage - a.match_percentage).map((item) => ({
    id: item.fpost_id, title: item.item_name, kind: "found", image: item.image_url || undefined, category: item.category,
    location: item.location, date: item.found_date, description: item.description, status: item.status,
  })), [foundResults]);
  const scoreOf = useMemo(() => new Map(foundResults.map((item) => [item.fpost_id, item.match_percentage])), [foundResults]);

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
    if (!verified) {
      setError("Verify your account first. Open My Profile and upload an ID.");
      return;
    }
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

  const reportFiltersActive = Boolean(reportSearch || reportCategory || reportLocation);
  const summaryOf = (id: string) => matchSummaries[id] || { matched_above_55: 0, matched_below_54: 0, total_matches: 0 };
  const tabs = [["intake", "Report form", ClipboardList], ["reports", "My missing reports", FileStack], ["search", "Search found items", Search]] as const;

  return (
    <main className={CX.page}>
      <div className="mx-auto w-full max-w-[1100px]">
        <header className="mb-6 flex items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(145deg,#3b5394,#1f3160)] text-tide-200 shadow-[0_14px_30px_-14px_rgba(17,27,66,0.9)]">
            <SearchCheck size={24} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className={CX.eyebrow}>Missing items</p>
            <h1 className={`${CX.pageTitle} mt-0.5`}>{focused || activeTab === "intake" ? "Report a lost item" : activeTab === "reports" ? "My missing reports" : "Search found items"}</h1>
            <p className={CX.pageLead}>Describe what you lost and we'll keep checking every found item for a match.</p>
          </div>
        </header>

        {focused ? (
          <button type="button" onClick={() => onBack?.("report-item")} className={`${CX.btnGhost} mb-5`}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to report choices
          </button>
        ) : (
          <div role="tablist" aria-label="Missing item views" className="glass no-scrollbar mb-6 flex w-full gap-1 overflow-x-auto rounded-[18px] p-1.5 sm:inline-flex sm:w-auto">
            {tabs.map(([tab, label, Icon]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => switchTab(tab)}
                className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition-colors ${
                  activeTab === tab ? "bg-[linear-gradient(180deg,#2b4282_0%,#1f3160_100%)] text-white shadow-[0_8px_18px_-10px_rgba(17,27,66,0.8)]" : "text-ink-soft hover:bg-white/80"
                }`}
              >
                <Icon size={16} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
        )}

        {error && <div role="alert" className={`${CX.alertError} mb-5`}>{error}</div>}

        {(focused || activeTab === "intake") && onBack && <VerificationGate action="report a missing item" onNavigate={onBack} className="mb-5" />}

        {focused || activeTab === "intake" ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <form onSubmit={handleSubmit} className="space-y-5">
              <section className={`${CX.card} overflow-hidden`} aria-labelledby="missing-photo-heading">
                <div className="flex items-center gap-3 border-b border-line px-5 py-4 sm:px-6">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-iris-50 text-iris-600"><ImagePlus size={17} aria-hidden="true" /></span>
                  <div>
                    <h2 id="missing-photo-heading" className="text-[16px] font-semibold text-ink">Reference photo</h2>
                    <p className="text-[13px] text-ink-muted">Optional, but a similar photo makes matching faster.</p>
                  </div>
                </div>
                <div className="p-5 sm:p-6">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => { event.preventDefault(); selectImage(event.dataTransfer.files[0]); }}
                    className="group relative flex min-h-[190px] w-full items-center justify-center overflow-hidden rounded-[20px] border-2 border-dashed border-iris-300 bg-[radial-gradient(80%_80%_at_50%_0%,#eef2fe,#ffffff)] dark:border-iris-500/40 dark:bg-[radial-gradient(80%_80%_at_50%_0%,rgba(110,142,240,0.16),rgba(255,255,255,0.02))] p-4 transition-colors hover:border-iris-500"
                    aria-label={imagePreview ? "Change reference photo" : "Upload reference photo"}
                  >
                    {imagePreview ? (
                      <>
                        <img decoding="async" src={imagePreview} alt="Missing item preview" className="max-h-[250px] rounded-2xl object-contain shadow-card" />
                        <span className="glass-dark absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"><RefreshCw size={13} aria-hidden="true" />Change photo</span>
                      </>
                    ) : (
                      <span className="flex flex-col items-center text-center">
                        <span className="flex size-16 items-center justify-center rounded-2xl bg-white text-iris-600 shadow-card transition-transform group-hover:scale-105"><ImagePlus size={28} aria-hidden="true" /></span>
                        <span className="mt-3 text-[15px] font-semibold text-ink">Tap to add a photo</span>
                        <span className="mt-1 text-[13px] text-ink-muted">or drag and drop an image here</span>
                      </span>
                    )}
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => selectImage(event.target.files?.[0])} />
                </div>
              </section>

              <section className={`${CX.card} p-5 sm:p-6`} aria-labelledby="missing-details-heading">
                <h2 id="missing-details-heading" className="mb-4 text-[16px] font-semibold text-ink">What did you lose?</h2>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Item name" value={itemName} onChange={setItemName} placeholder="Black leather wallet" required />
                  <SelectField label="Category" value={category} onChange={setCategory} options={CATEGORIES} />
                  <SelectField label="Last seen location" value={lastLocation} onChange={setLastLocation} options={CAMPUS_LOCATIONS} icon={<MapPin size={15} />} />
                  <Field label="Last seen date" value={lastSeenDate} onChange={setLastSeenDate} type="date" icon={<CalendarRange size={15} />} required />
                  <div className="md:col-span-2"><TextAreaField label="Description" value={description} onChange={setDescription} placeholder="Include brand, color, size, condition, and visible features." required /></div>
                  <div className="md:col-span-2"><TextAreaField label="Private distinctive marks" value={distinctiveMarks} onChange={setDistinctiveMarks} placeholder="Optional: unique marks or contents to verify a future claim." icon={<Tag size={15} />} /></div>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-[14px] leading-6 transition-colors md:col-span-2 ${authorized ? "border-tide-200 bg-tide-50 text-ink" : "border-line bg-frost-50 text-ink-soft"}`}>
                    <input type="checkbox" required checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} className="mt-1 size-[18px] shrink-0 accent-navy-800" />
                    I authorize E-Balik to compare this report with found-item records and notify me about possible matches.
                  </label>
                </div>
              </section>

              <div className="glass sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 flex flex-col gap-3 rounded-[20px] p-4 sm:flex-row sm:items-center sm:justify-between lg:bottom-4">
                <p className="flex items-center gap-2 text-[13px] text-ink-muted">
                  <UserRound size={15} className="shrink-0 text-iris-600" aria-hidden="true" />
                  <span className="min-w-0 truncate">Reporting as <span className="font-semibold text-ink">{user?.email}</span>{user?.campus_id ? ` · ${user.campus_id}` : ""}</span>
                </p>
                <button type="submit" disabled={isLoading || !verified} className={`${CX.btnNavy} shrink-0 px-6`}>
                  <BadgeCheck size={17} aria-hidden="true" />{isLoading ? "Saving…" : "Submit missing report"}
                </button>
              </div>
            </form>

            <aside className="h-fit space-y-4 lg:sticky lg:top-[92px]">
              <div className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(150deg,#22366a_0%,#162448_70%)] p-5 text-white shadow-raised">
                <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-tide-500/25 blur-2xl" aria-hidden="true" />
                <p className="relative flex items-center gap-2 text-[12px] font-semibold text-tide-200"><Lightbulb size={15} aria-hidden="true" />Smart matching</p>
                <p className="relative mt-3 text-[14px] leading-6 text-navy-100">Specific details help us compare your report with found items, while private clues stay out of public listings.</p>
                <ol className="relative mt-4 space-y-3 text-[14px]">
                  {["Add a clear photo if you have one.", "Record the last place and date you had it.", "Keep unique marks specific for claim verification."].map((tip, i) => (
                    <li key={tip} className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-semibold text-gold-300 ring-1 ring-white/20">{i + 1}</span><span className="text-navy-50">{tip}</span></li>
                  ))}
                </ol>
              </div>
            </aside>
          </div>
        ) : activeTab === "reports" ? (
          <div className="space-y-5">
            <div className="glass sticky top-[calc(76px+env(safe-area-inset-top))] z-20 rounded-[20px] p-3">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,1fr))_auto]">
                <label className="sr-only" htmlFor="missing-report-search">Search your missing reports</label>
                <input id="missing-report-search" type="search" value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Search ID, item, details…" className={`${CX.input} w-full`} />
                <label className="sr-only" htmlFor="missing-report-category">Category</label>
                <select id="missing-report-category" value={reportCategory} onChange={(event) => setReportCategory(event.target.value)} className={`${CX.input} w-full`}><option value="">All types</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
                <label className="sr-only" htmlFor="missing-report-location">Last location</label>
                <input id="missing-report-location" value={reportLocation} onChange={(event) => setReportLocation(event.target.value)} placeholder="Last location…" className={`${CX.input} w-full`} />
                <div className="flex items-center justify-end gap-2">
                  {reportFiltersActive && (
                    <button type="button" onClick={() => { setReportSearch(""); setReportCategory(""); setReportLocation(""); }} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-[13px] font-semibold text-iris-700 hover:bg-iris-50">
                      <X size={14} aria-hidden="true" />Clear
                    </button>
                  )}
                  <ViewToggle compact />
                </div>
              </div>
            </div>
            {reportsLoading ? <ReportGridSkeleton count={4} /> : (
              <ItemCollection
                label="Your missing reports"
                items={galleryReports}
                mode={mode}
                showKind={false}
                onOpen={(_item, index) => setOpenReport(filteredReports[index])}
                badge={(item) => <span className="inline-flex rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold capitalize text-navy-800 ring-1 ring-line">{item.status || "missing"}</span>}
                extra={(item) => {
                  const summary = summaryOf(item.id);
                  return (
                    <span className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800 ring-1 ring-emerald-200 tabular-nums">{summary.matched_above_55} likely</span>
                      <span className="rounded-full bg-frost-100 px-2 py-0.5 text-ink-soft ring-1 ring-line tabular-nums">{summary.total_matches} total</span>
                    </span>
                  );
                }}
                empty={
                  <div className="glass flex flex-col items-center gap-3 rounded-[22px] px-6 py-14 text-center">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-frost-100 text-iris-600"><FileStack size={26} aria-hidden="true" /></span>
                    <p className="text-[16px] font-semibold text-ink">{reportFiltersActive ? "No missing reports match these filters" : "You haven't reported a lost item yet"}</p>
                    <button type="button" onClick={() => switchTab("intake")} className={CX.btnNavy}>Report a lost item</button>
                  </div>
                }
              />
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <section className={`${CX.card} p-5 sm:p-6`} aria-labelledby="missing-search-heading">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-iris-50 text-iris-600"><Filter size={18} aria-hidden="true" /></span>
                  <div>
                    <h2 id="missing-search-heading" className="text-[17px] font-semibold text-ink">Find possible matches</h2>
                    <p className="text-[13px] text-ink-muted">Pick one of your reports to score found items against it, or just search.</p>
                  </div>
                </div>
                <ViewToggle compact />
              </div>
              <form onSubmit={(event) => { event.preventDefault(); void searchReports(); }} className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <label className="sr-only" htmlFor="missing-search-report">Your missing report</label>
                <select id="missing-search-report" value={selectedReportId} onChange={(event) => setSelectedReportId(event.target.value)} className={`${CX.input} w-full`}><option value="">Score against… (optional)</option>{reports.map((report) => <option key={report.mpost_id} value={report.mpost_id}>{report.mpost_id} · {report.item_name}</option>)}</select>
                <label className="sr-only" htmlFor="missing-search-query">Search</label>
                <input id="missing-search-query" type="search" enterKeyHint="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Item or details" className={`${CX.input} w-full`} />
                <label className="sr-only" htmlFor="missing-search-category">Category</label>
                <select id="missing-search-category" value={searchCategory} onChange={(event) => setSearchCategory(event.target.value)} className={`${CX.input} w-full`}><option value="">All types</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
                <label className="sr-only" htmlFor="missing-search-location">Location</label>
                <input id="missing-search-location" value={searchLocation} onChange={(event) => setSearchLocation(event.target.value)} placeholder="Location contains…" className={`${CX.input} w-full`} />
                <label className="sr-only" htmlFor="missing-search-date">Date found</label>
                <input id="missing-search-date" type="date" value={searchDate} onChange={(event) => setSearchDate(event.target.value)} className={`${CX.input} w-full`} />
                <button type="submit" disabled={resultsLoading} className={`${CX.btnNavy} w-full`}><Search size={16} aria-hidden="true" />{resultsLoading ? "Searching…" : "Search found items"}</button>
              </form>
            </section>
            {resultsLoading ? <ReportGridSkeleton count={4} /> : (
              <ItemCollection
                label="Found item results"
                items={galleryResults}
                mode={mode}
                showKind={false}
                onOpen={(_item, index) => setResultIndex(index)}
                badge={(item) => {
                  const pct = scoreOf.get(item.id) ?? 0;
                  const tone = pct >= 75 ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : pct >= 55 ? "bg-gold-50 text-gold-800 ring-gold-200" : "bg-white/95 text-ink-soft ring-line";
                  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums ring-1 ${tone}`}>{pct}%</span>;
                }}
                empty={
                  <div className="glass flex flex-col items-center gap-3 rounded-[22px] px-6 py-14 text-center">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-frost-100 text-iris-600"><Search size={26} aria-hidden="true" /></span>
                    <p className="text-[16px] font-semibold text-ink">No matching found items yet</p>
                    <p className="max-w-[44ch] text-[14px] text-ink-muted">Adjust the filters and search again. New found items are added all the time.</p>
                  </div>
                }
              />
            )}
          </div>
        )}
      </div>

      {resultIndex !== null && galleryResults[resultIndex] && (
        <ItemViewer
          items={galleryResults}
          index={resultIndex}
          onIndexChange={setResultIndex}
          onClose={() => setResultIndex(null)}
          note={(item) => (
            <p className="rounded-2xl border border-iris-200 bg-iris-50 px-4 py-3 text-[14px] text-iris-700">
              Match score: <span className="font-semibold tabular-nums">{scoreOf.get(item.id) ?? 0}%</span>{selectedReportId ? ` against ${selectedReportId}` : ""}.
            </p>
          )}
          actions={onBack ? (item) => (
            <button type="button" onClick={() => { setResultIndex(null); onBack("claim", { foundItemId: item.id, missingReportId: selectedReportId || undefined }); }} className={`${CX.btnGold} w-full`}>
              This is mine, start a claim <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : undefined}
        />
      )}

      {/* Report details */}
      <Modal
        open={Boolean(openReport)}
        onClose={() => setOpenReport(null)}
        size="lg"
        tone="mint"
        icon={<SearchCheck size={21} />}
        eyebrow={openReport ? `Missing report · ${openReport.mpost_id}` : undefined}
        title={openReport?.item_name}
        hero={openReport?.image_url ? <ItemImage item={{ image: openReport.image_url, title: openReport.item_name, category: openReport.category }} className="h-[200px] w-full sm:h-[240px]" /> : undefined}
        footer={
          <>
            {onBack && openReport && (
              <button type="button" onClick={() => { const id = openReport.mpost_id; setOpenReport(null); onBack("matches", { reportId: id }); }} className={CX.btnGhost}>See matches</button>
            )}
            <button type="button" onClick={() => setOpenReport(null)} className={CX.btnNavy}>Done</button>
          </>
        }
      >
        {openReport && (
          <div className="space-y-4">
            <p className="whitespace-pre-line text-[15px] leading-7 text-ink-soft">{openReport.description || "No description provided."}</p>
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ["Category", openReport.category], ["Status", openReport.status || "missing"],
                ["Last seen at", openReport.last_location], ["Date lost", openReport.last_seen_date],
                ...(openReport.distinctive_marks ? [["Private marks (only you and admins)", openReport.distinctive_marks]] : []),
              ].map(([label, value]) => (
                <div key={label} className={`rounded-2xl border border-line bg-frost-50 p-3.5 ${label.startsWith("Private") ? "sm:col-span-2" : ""}`}>
                  <dt className="text-[12px] font-medium text-ink-muted">{label}</dt>
                  <dd className="mt-0.5 break-words text-[15px] font-semibold text-ink">{value || "Not recorded"}</dd>
                </div>
              ))}
            </dl>
            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-white p-3 text-center">
              {[
                ["55%+ matched", summaryOf(openReport.mpost_id).matched_above_55, "text-emerald-700"],
                ["54% or lower", summaryOf(openReport.mpost_id).matched_below_54, "text-gold-700"],
                ["Total matches", summaryOf(openReport.mpost_id).total_matches, "text-navy-800"],
              ].map(([label, value, tone]) => (
                <div key={label as string}>
                  <p className={`font-[family-name:var(--font-heading)] text-[22px] font-semibold tabular-nums ${tone}`}>{value as number}</p>
                  <p className="text-[12px] font-medium text-ink-muted">{label as string}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Authenticity confirmation */}
      <Modal
        open={confirmationOpen}
        onClose={() => setConfirmationOpen(false)}
        dismissible={!isLoading}
        size="sm"
        tone="navy"
        icon={<SearchCheck size={21} />}
        eyebrow="Authenticity confirmation"
        title="Confirm this missing report"
        description="Reports must be valid and authentic. False or misleading reports may lead to disciplinary or legal action under university rules."
        footer={
          <>
            <button type="button" disabled={isLoading} onClick={() => setConfirmationOpen(false)} className={CX.btnGhost}>Cancel</button>
            <button type="button" disabled={!agreed || countdown > 0 || isLoading} onClick={() => void confirmSubmit()} className={CX.btnNavy}>{isLoading ? "Submitting…" : "Confirm and submit"}</button>
          </>
        }
      >
        <CountdownConsent
          countdown={countdown}
          checked={agreed}
          onCheckedChange={setAgreed}
          label="I confirm this report is truthful and describes an item that belongs to me."
        />
      </Modal>
    </main>
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
