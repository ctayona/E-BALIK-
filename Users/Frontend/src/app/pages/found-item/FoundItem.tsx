import { useEffect, useId, useMemo, useRef, useState } from "react";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import { ArrowLeft, BadgeCheck, CalendarRange, ChevronDown, ClipboardList, FileStack, ImagePlus, MapPin, PackageSearch, RefreshCw, ShieldCheck, Tag, UserRound, X } from "lucide-react";
import { useAuth } from "@/app/utils/useAuth";
import PhotoSourceButtons from "@/app/shared/PhotoSourceButtons";
import { useVerificationPrompt } from "@/app/shared/verification/VerificationRequiredModal";
import { CX } from "@/app/utils/clay";
import type { NavigationOptions, Page } from "@/app/types";
import DataPrivacyConsent from "@/app/shared/privacy/DataPrivacyConsent";
import { showSubmitError } from "@/app/utils/submitErrors";
import { ReportGridSkeleton } from "@/app/shared/LoadingSkeleton";
import ItemCollection from "@/app/shared/media/ItemCollection";
import ItemImage, { type GalleryItem } from "@/app/shared/media/ItemImage";
import ViewToggle from "@/app/shared/view/ViewToggle";
import { useViewMode } from "@/app/shared/view/useViewMode";
import Modal, { CountdownConsent } from "@/app/shared/modal/Modal";
import VerificationGate from "@/app/shared/verification/VerificationGate";
import { isVerified, useCurrentUser } from "@/app/utils/system";

const CATEGORIES = ["Bags & Luggage", "Electronics", "Accessories", "Personal Effects", "Documents & Cards", "Clothing", "Keys", "Valuables", "Others"];
const FOUND_LOCATIONS = ["Main Building Lobby", "Student Center", "Library", "ICT Building", "Faculty Hall", "Cafeteria", "Gym", "Other"];
const OTHER_GUARD = "__other__";
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

export default function FoundItem({ focused = false, onBack }: { focused?: boolean; onBack?: (page: Page, options?: NavigationOptions) => void }) {
  const { createFoundItem, getFoundItems, getFoundMatchSummaries, getGuards, isLoading, user } = useAuth();
  const verified = isVerified(useCurrentUser());
  const { ensure, prompt } = useVerificationPrompt(onBack, "report a found item");
  const [activeTab, setActiveTab] = useState<"intake" | "reports">("intake");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState(FOUND_LOCATIONS[0]);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [dateFound, setDateFound] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [distinctiveMarks, setDistinctiveMarks] = useState("");
  const [turnoverLocation, setTurnoverLocation] = useState(TURNOVER_LOCATIONS[0]);
  const [guardNameOrId, setGuardNameOrId] = useState("");
  const [guards, setGuards] = useState<Array<{ id: string; name: string }>>([]);
  const [guardsLoading, setGuardsLoading] = useState(true);
  const [guardId, setGuardId] = useState("");
  const [image, setImage] = useState<File | undefined>();
  const [imagePreview, setImagePreview] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [agreed, setAgreed] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [matchSummaries, setMatchSummaries] = useState<Record<string, MatchSummary>>({});
  const [reportSearch, setReportSearch] = useState("");
  const [reportCategory, setReportCategory] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [reportLocation, setReportLocation] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode] = useViewMode();
  const [openReport, setOpenReport] = useState<Report | null>(null);

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

  const galleryReports = useMemo<GalleryItem[]>(() => filteredReports.map((report) => ({
    id: report.fpost_id, title: report.item_name, kind: "found", image: report.image_url || undefined, category: report.category,
    location: report.location, date: report.found_date, description: report.description, heldAt: report.turnover_location, status: report.status,
  })), [filteredReports]);

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

  // The finder picks the guard who received the item. Typing a name is the fallback when the guard is not listed (or no guard has an account yet).
  useEffect(() => {
    let active = true;
    void getGuards().then((result) => {
      if (active) setGuards(result.guards);
    }).finally(() => {
      if (active) setGuardsLoading(false);
    });
    return () => { active = false; };
  }, [getGuards]);
  const typingGuardName = guardId === OTHER_GUARD || (!guardsLoading && guards.length === 0);
  const chosenGuard = guards.find((guard) => guard.id === guardId);
  const guardLabel = typingGuardName ? guardNameOrId.trim() : chosenGuard?.name || "";

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!ensure()) return;
    if (!guardLabel) {
      setError(typingGuardName ? "Enter the name or ID number of the guard who received the item." : "Choose the guard who received the item.");
      return;
    }
    setCountdown(5);
    setAgreed(false);
    setPrivacy(false);
    setConfirmationOpen(true);
  }

  /** Guarded entry point: a second click or Enter while the request is running is ignored, so one submit means one report. */
  async function confirmSubmit() {
    if (!agreed || !privacy || countdown > 0 || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await publishFoundReport();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function publishFoundReport() {
    const result = await createFoundItem({
      item_name: title,
      category,
      description: [description, distinctiveMarks && `Distinctive marks: ${distinctiveMarks}`].filter(Boolean).join("\n\n"),
      location,
      found_date: dateFound,
      turnover_location: turnoverLocation,
      guard_name_or_id: typingGuardName ? guardNameOrId.trim() : "",
      handover_guard_id: !typingGuardName && chosenGuard ? chosenGuard.id : undefined,
      dpa_consent: privacy,
      image,
    });
    setConfirmationOpen(false);
    if (!result.success) {
      showSubmitError(result, "Found report not published", "Unable to save found item report.");
      return;
    }
    const created = (result.item || null) as Report | null;
    showInfoModal({
      variant: "success",
      title: "Found report published",
      message: "Thank you. The report is recorded and the item is logged as turned over for safekeeping. Owners can now match against it.",
      reference: created?.fpost_id,
      details: [`Turned over at ${turnoverLocation}${guardLabel ? ` to ${guardLabel}` : ""}.`],
    });
    setTitle("");
    setDescription("");
    setDistinctiveMarks("");
    setGuardNameOrId("");
    setGuardId("");
    setImage(undefined);
    setImagePreview("");
    if (fileRef.current) fileRef.current.value = "";
    // Take the reporter to the new report so they can see it was saved.
    onBack?.("my-reports", { highlightReportId: created?.fpost_id });
  }

  function switchTab(tab: "intake" | "reports") {
    setActiveTab(tab);
    if (tab === "reports") void loadReports();
  }

  const filtersActive = Boolean(reportSearch || reportCategory || reportStatus || reportLocation);
  const summaryOf = (id: string) => matchSummaries[id] || { matched_above_55: 0, matched_below_54: 0, total_matches: 0 };

  return (
    <main className={CX.page}>
      {prompt}
      <div className="mx-auto w-full max-w-[1040px]">
        <header className="mb-6 flex items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(145deg,#e6be76,#c9953f)] text-navy-950 shadow-[0_14px_30px_-14px_rgba(209,161,83,0.9)]">
            <PackageSearch size={24} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className={CX.eyebrow}>Found items</p>
            <h1 className={`${CX.pageTitle} mt-0.5`}>{focused || activeTab === "intake" ? "Report a found item" : "My found reports"}</h1>
            <p className={CX.pageLead}>Log what you found and where you handed it over. Owners are matched automatically.</p>
          </div>
        </header>

        {focused ? (
          <button type="button" onClick={() => onBack?.("report-item")} className={`${CX.btnGhost} mb-5`}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to report choices
          </button>
        ) : (
          <div role="tablist" aria-label="Found item views" className="glass mb-6 inline-flex w-full gap-1 rounded-[18px] p-1.5 sm:w-auto">
            {([["intake", "Report form", ClipboardList], ["reports", "My found reports", FileStack]] as const).map(([tab, label, Icon]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => switchTab(tab)}
                className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition-colors sm:flex-none ${
                  activeTab === tab ? "bg-[linear-gradient(180deg,#2b4282_0%,#1f3160_100%)] text-white shadow-[0_8px_18px_-10px_rgba(17,27,66,0.8)]" : "text-ink-soft hover:bg-white/80"
                }`}
              >
                <Icon size={16} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
        )}

        {error && <div role="alert" className={`${CX.alertError} mb-5`}>{error}</div>}

        {(focused || activeTab === "intake") && onBack && <VerificationGate action="report a found item" onNavigate={onBack} className="mb-5" />}

        {focused || activeTab === "intake" ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            <section className={`${CX.card} overflow-hidden`} aria-labelledby="found-photo-heading">
              <div className="flex items-center gap-3 border-b border-line px-5 py-4 sm:px-6">
                <span className="flex size-9 items-center justify-center rounded-xl bg-iris-50 text-iris-600"><ImagePlus size={17} aria-hidden="true" /></span>
                <div>
                  <h2 id="found-photo-heading" className="text-[16px] font-semibold text-ink">Photo of the item</h2>
                  <p className="text-[13px] text-ink-muted">A clear photo helps the owner recognise it quickly.</p>
                </div>
              </div>
              <div className="p-5 sm:p-6">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); selectImage(event.dataTransfer.files[0]); }}
                  className="group relative flex min-h-[200px] w-full items-center justify-center overflow-hidden rounded-[20px] border-2 border-dashed border-gold-300 bg-[radial-gradient(80%_80%_at_50%_0%,#fdf8ee,#ffffff)] dark:border-gold-500/40 dark:bg-[radial-gradient(80%_80%_at_50%_0%,rgba(209,161,83,0.16),rgba(255,255,255,0.02))] p-4 transition-colors hover:border-gold-500"
                  aria-label={imagePreview ? "Change item photo" : "Upload item photo"}
                >
                  {imagePreview ? (
                    <>
                      <img decoding="async" src={imagePreview} alt="Found item preview" className="max-h-[260px] rounded-2xl object-contain shadow-card" />
                      <span className="glass-dark absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"><RefreshCw size={13} aria-hidden="true" />Change photo</span>
                    </>
                  ) : (
                    <span className="flex flex-col items-center text-center">
                      <span className="flex size-16 items-center justify-center rounded-2xl bg-white text-gold-600 shadow-card transition-transform group-hover:scale-105"><ImagePlus size={28} aria-hidden="true" /></span>
                      <span className="mt-3 text-[15px] font-semibold text-ink">Tap to add a photo</span>
                      <span className="mt-1 text-[13px] text-ink-muted">or drag and drop an image here</span>
                    </span>
                  )}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => selectImage(event.target.files?.[0])} />
                <PhotoSourceButtons className="mt-3" onFile={selectImage} />
              </div>
            </section>

            <section className={`${CX.card} p-5 sm:p-6`} aria-labelledby="found-details-heading">
              <h2 id="found-details-heading" className="mb-4 text-[16px] font-semibold text-ink">Item details</h2>
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Item title / short description" value={title} onChange={setTitle} placeholder="Blue backpack with red zipper" required />
                <SelectField label="Category" value={category} onChange={setCategory} options={CATEGORIES} />
                <SelectField label="Where was it found?" value={location} onChange={setLocation} options={FOUND_LOCATIONS} icon={<MapPin size={15} />} />
                <Field label="Date found" value={dateFound} onChange={setDateFound} type="date" icon={<CalendarRange size={15} />} required />
                <div className="md:col-span-2"><TextAreaField label="Description / identifying details" value={description} onChange={setDescription} placeholder="Brand, color, size, and visible details." /></div>
                <div className="md:col-span-2"><TextAreaField label="Distinctive marks / proof-of-ownership notes" value={distinctiveMarks} onChange={setDistinctiveMarks} placeholder="Keep private marks useful for later claim verification." icon={<Tag size={15} />} /></div>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-[20px] border border-gold-200 bg-[linear-gradient(135deg,#fdf8ee_0%,#ffffff_70%)] dark:border-gold-500/25 dark:bg-[linear-gradient(135deg,rgba(209,161,83,0.14)_0%,rgba(19,29,58,0.62)_70%)] p-5 shadow-card sm:p-6" aria-labelledby="found-handover-heading">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#e6be76,#c9953f)] text-navy-950"><ShieldCheck size={19} aria-hidden="true" /></span>
                <div>
                  <h2 id="found-handover-heading" className="text-[16px] font-semibold text-ink">Hand it over to campus security</h2>
                  <p className="mt-0.5 text-[13px] text-ink-muted">The report status is controlled by the system. Record where and to whom the item was handed over.</p>
                </div>
              </div>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <SelectField label="Security guard location" value={turnoverLocation} onChange={setTurnoverLocation} options={TURNOVER_LOCATIONS} />
                <div className="space-y-4">
                  {guards.length > 0 && (
                    <GuardSelect guards={guards} value={guardId} onChange={setGuardId} />
                  )}
                  {typingGuardName && (
                    <Field label={guards.length > 0 ? "Guard name or ID number" : "Guard name or ID number"} value={guardNameOrId} onChange={setGuardNameOrId} placeholder="Guard Santos / SG-014" required />
                  )}
                </div>
              </div>
            </section>

            <div className="glass sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 flex flex-col gap-3 rounded-[20px] p-4 sm:flex-row sm:items-center sm:justify-between lg:bottom-4">
              <p className="flex items-center gap-2 text-[13px] text-ink-muted">
                <UserRound size={15} className="shrink-0 text-iris-600" aria-hidden="true" />
                <span className="min-w-0 truncate">Reporting as <span className="font-semibold text-ink">{user?.email}</span>{user?.campus_id ? ` · ${user.campus_id}` : ""}</span>
              </p>
              <button type="submit" disabled={isLoading} className={`${CX.btnGold} shrink-0 px-6`}>
                <BadgeCheck size={17} aria-hidden="true" />{isLoading ? "Saving…" : "Publish found report"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-5">
            <div className="glass sticky top-[calc(76px+env(safe-area-inset-top))] z-20 rounded-[20px] p-3">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto]">
                <label className="sr-only" htmlFor="found-report-search">Search your found reports</label>
                <input id="found-report-search" type="search" value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Search ID, item, guard…" className={`${CX.input} w-full`} />
                <label className="sr-only" htmlFor="found-report-category">Category</label>
                <select id="found-report-category" value={reportCategory} onChange={(event) => setReportCategory(event.target.value)} className={`${CX.input} w-full`}><option value="">All types</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
                <label className="sr-only" htmlFor="found-report-status">Status</label>
                <select id="found-report-status" value={reportStatus} onChange={(event) => setReportStatus(event.target.value)} className={`${CX.input} w-full`}><option value="">All statuses</option><option value="unclaimed">Unclaimed</option><option value="claimed">Claimed</option><option value="returned">Returned</option></select>
                <label className="sr-only" htmlFor="found-report-location">Location</label>
                <input id="found-report-location" value={reportLocation} onChange={(event) => setReportLocation(event.target.value)} placeholder="Location…" className={`${CX.input} w-full`} />
                <div className="flex items-center justify-end gap-2">
                  {filtersActive && (
                    <button type="button" onClick={() => { setReportSearch(""); setReportCategory(""); setReportStatus(""); setReportLocation(""); }} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-[13px] font-semibold text-iris-700 hover:bg-iris-50">
                      <X size={14} aria-hidden="true" />Clear
                    </button>
                  )}
                  <ViewToggle compact />
                </div>
              </div>
            </div>

            {reportsLoading ? <ReportGridSkeleton count={4} /> : (
              <ItemCollection
                label="Your found reports"
                items={galleryReports}
                mode={mode}
                showKind={false}
                onOpen={(_item, index) => setOpenReport(filteredReports[index])}
                badge={(item) => <span className="inline-flex rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold capitalize text-navy-800 ring-1 ring-line">{item.status || "unclaimed"}</span>}
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
                    <p className="text-[16px] font-semibold text-ink">{filtersActive ? "No found reports match these filters" : "You haven't reported a found item yet"}</p>
                    <button type="button" onClick={() => switchTab("intake")} className={CX.btnGold}>Report a found item</button>
                  </div>
                }
              />
            )}
          </div>
        )}
      </div>

      {/* Report details */}
      <Modal
        open={Boolean(openReport)}
        onClose={() => setOpenReport(null)}
        size="lg"
        tone="gold"
        icon={<ShieldCheck size={21} />}
        eyebrow={openReport ? `Found report · ${openReport.fpost_id}` : undefined}
        title={openReport?.item_name}
        hero={openReport?.image_url ? <ItemImage item={{ image: openReport.image_url, title: openReport.item_name, category: openReport.category }} className="h-[200px] w-full sm:h-[240px]" /> : undefined}
        footer={<button type="button" onClick={() => setOpenReport(null)} className={CX.btnNavy}>Done</button>}
      >
        {openReport && (
          <div className="space-y-4">
            <p className="whitespace-pre-line text-[15px] leading-7 text-ink-soft">{openReport.description || "No description provided."}</p>
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ["Category", openReport.category], ["Status", openReport.status || "unclaimed"],
                ["Found at", openReport.location], ["Date found", openReport.found_date],
                ["Turned over at", openReport.turnover_location], ["Guard", openReport.guard_name_or_id],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-line bg-frost-50 p-3.5">
                  <dt className="text-[12px] font-medium text-ink-muted">{label}</dt>
                  <dd className="mt-0.5 break-words text-[15px] font-semibold capitalize text-ink">{value || "Not recorded"}</dd>
                </div>
              ))}
            </dl>
            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-white p-3 text-center">
              {[
                ["55%+ matched", summaryOf(openReport.fpost_id).matched_above_55, "text-emerald-700"],
                ["54% or lower", summaryOf(openReport.fpost_id).matched_below_54, "text-gold-700"],
                ["Total matches", summaryOf(openReport.fpost_id).total_matches, "text-navy-800"],
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
        dismissible={!isLoading && !submitting}
        size="sm"
        tone="gold"
        icon={<ShieldCheck size={21} />}
        eyebrow="Authenticity confirmation"
        title="Confirm this found report"
        description="Reports must be valid and authentic. False or misleading reports may lead to disciplinary or legal action under university rules."
        footer={
          <>
            <button type="button" disabled={isLoading || submitting} onClick={() => setConfirmationOpen(false)} className={CX.btnGhost}>Cancel</button>
            <button type="button" disabled={!agreed || !privacy || countdown > 0 || isLoading || submitting} onClick={() => void confirmSubmit()} className={CX.btnGold}>{isLoading || submitting ? "Publishing…" : "Confirm and publish"}</button>
          </>
        }
      >
        <CountdownConsent
          countdown={countdown}
          checked={agreed}
          onCheckedChange={setAgreed}
          label="I agree that the information submitted is truthful and that the item has been turned over as recorded."
        />
        <div className="mt-3"><DataPrivacyConsent checked={privacy} onChange={setPrivacy} disabled={countdown > 0} purpose="record this found item report and match it to its owner" /></div>
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

function GuardSelect({ guards, value, onChange }: { guards: Array<{ id: string; name: string }>; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} label="Which guard received it?" required icon={<UserRound size={15} />} />
      <div className="relative">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} required className={`${CX.input} w-full appearance-none pr-10`}>
          <option value="">Choose a guard</option>
          {guards.map((guard) => <option key={guard.id} value={guard.id}>{guard.name}</option>)}
          <option value={OTHER_GUARD}>Another guard (not listed)</option>
        </select>
        <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
      </div>
      <p className={CX.helper}>The guard is told that you handed the item to them.</p>
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
