import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock3, FileText, ImagePlus, Mail, MapPin, Phone, ShieldCheck, Trash2, Upload, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "@/app/utils/useAuth";
import PhotoSourceButtons from "@/app/shared/PhotoSourceButtons";
import type { Page } from "@/app/types";
import { CX, SPRING } from "@/app/utils/clay";
import { ReportGridSkeleton } from "@/app/shared/LoadingSkeleton";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import Modal, { CountdownConsent } from "@/app/shared/modal/Modal";
import DataPrivacyConsent from "@/app/shared/privacy/DataPrivacyConsent";
import { showSubmitError } from "@/app/utils/submitErrors";
import VerificationGate from "@/app/shared/verification/VerificationGate";
import HandoverQr from "@/app/shared/claims/HandoverQr";
import { isVerified, useCurrentUser } from "@/app/utils/system";
import { isCompletedReport } from "@/app/utils/reportLifecycle";
import { useVerificationPrompt } from "@/app/shared/verification/VerificationRequiredModal";

type ClaimRecord = {
  claim_id: string; claim_reference?: string; fpost_id?: string; claim_reason?: string;
  proof_image_url?: string; rejection_reason?: string; status: "pending" | "approved_for_pickup" | "approved" | "rejected" | "collected" | string;
  created_at?: string; handover_pin?: string | null;
  found_items?: { fpost_id?: string; item_name?: string; category?: string; location?: string; found_date?: string };
};

export default function Claim({ foundItemId = "", missingReportId = "", onNavigate }: { foundItemId?: string; missingReportId?: string; onNavigate?: (page: Page) => void }) {
  // All state & logic preserved exactly
  const { cancelClaim, createClaim, getClaims, getMissingItems, isLoading } = useAuth();
  const verified = isVerified(useCurrentUser());
  const { ensure, prompt } = useVerificationPrompt(onNavigate, "file a claim");
  const [reference,    setReference]    = useState(foundItemId);
  const [myLostReports, setMyLostReports] = useState<Array<{ mpost_id: string; item_name: string; last_location?: string }>>([]);
  const [lostReportId,  setLostReportId]  = useState(missingReportId);
  const [reason,       setReason]       = useState("");
  const [proof,        setProof]        = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState("");
  const [identityDocument, setIdentityDocument] = useState<File | null>(null);
  const [identityDocumentType, setIdentityDocumentType] = useState("campus_id");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [truthConfirmed, setTruthConfirmed] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [claims,       setClaims]       = useState<ClaimRecord[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved_for_pickup" | "rejected" | "collected">("all");
  const [error,        setError]        = useState("");
  const [activeTab,    setActiveTab]    = useState<"submit" | "history">(foundItemId ? "submit" : "history");

  async function loadClaims() {
    setClaimsLoading(true);
    try {
      const result = await getClaims();
      if (result.success) setClaims(result.claims as ClaimRecord[]);
      else showInfoModal({ variant: "error", title: "Could not load your claims", message: result.error || "Unable to load your claims." });
    } finally {
      setClaimsLoading(false);
    }
  }

  useEffect(() => { setReference(foundItemId); if (foundItemId) setActiveTab("submit"); }, [foundItemId]);
  useEffect(() => { void loadClaims(); }, [getClaims]);
  // Optional link: which of the claimant's own open lost reports this item is. The report is completed with the claim once the item is collected.
  useEffect(() => {
    let active = true;
    void getMissingItems().then((result) => {
      if (!active) return;
      const open = ((result.items || []) as Array<{ mpost_id: string; item_name: string; last_location?: string; status?: string }>)
        .filter((item) => !isCompletedReport("Missing", item.status));
      setMyLostReports(open);
      // Arriving from Matches with a lost report already chosen: keep it only if it is still one of the open reports.
      setLostReportId((current) => (open.some((item) => item.mpost_id === current) ? current : ""));
    });
    return () => { active = false; };
  }, [getMissingItems]);
  useEffect(() => {
    if (!confirmationOpen || countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [confirmationOpen, countdown]);

  function chooseProof(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) { setError("Choose a JPG, PNG, WEBP, or GIF image."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("Ownership proof images must be 10 MB or smaller."); return; }
    setProof(file);
    setProofPreview(URL.createObjectURL(file));
    setError("");
  }

  function chooseIdentityDocument(file?: File) {
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      setError("Upload a JPG, PNG, WEBP, or PDF identity document.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Identity documents must be 10 MB or smaller.");
      return;
    }
    setIdentityDocument(file);
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!ensure()) return;
    if (!reference.trim() || !reason.trim() || !proof || !identityDocument) {
      setError("Found item reference, claim reason, ownership proof, and a valid ID are required."); return;
    }
    setCountdown(5);
    setTruthConfirmed(false);
    setPrivacy(false);
    setConfirmationOpen(true);
  }

  /**
   * Guarded entry point. createClaim does not set the shared isLoading flag, so without this a double-click on
   * "Confirm claim" sent two requests and created two claim records with different IDs.
   */
  async function confirmSubmission() {
    if (countdown > 0 || !truthConfirmed || !privacy || !proof || !identityDocument || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await sendClaim(proof, identityDocument);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function sendClaim(proof: File, identityDocument: File) {
    const result = await createClaim({
      fpost_id: reference.trim(),
      claim_reason: reason.trim(),
      proof_image: proof,
      identity_document: identityDocument,
      identity_document_type: identityDocumentType,
      dpa_consent: privacy,
      missing_report_id: lostReportId || undefined,
    });
    setConfirmationOpen(false);
    if (!result.success) {
      showSubmitError(result, "Claim not submitted", "Unable to submit claim.");
      return;
    }
    showInfoModal({
      variant: "success",
      title: "Claim submitted for review",
      message: "An administrator will review your ownership proof and ID. You'll be notified when there is a decision.",
      reference: result.claim?.claim_reference || result.claim?.claim_id || undefined,
      details: ["Track the review status in Claim history.", "Bring the same ID when collecting the item in person.", ...(result.auctionNotice ? [result.auctionNotice] : [])],
    });
    setReason(""); setProof(null); setProofPreview(""); setIdentityDocument(null); setLostReportId("");
    await loadClaims();
  }

  async function cancel(claimId: string) {
    setError("");
    const result = await cancelClaim(claimId);
    if (!result.success) {
      showInfoModal({ variant: "error", title: "Claim not cancelled", message: result.error || "Unable to cancel claim." });
      return;
    }
    showInfoModal({ variant: "success", title: "Claim cancelled", message: "Your claim request was withdrawn and removed from the review queue." });
    await loadClaims();
  }

  function statusStyle(status: string) {
    if (status === "approved" || status === "approved_for_pickup") return { icon: <CheckCircle2 size={14} />, badge: CX.badgeGreen, label: "Approved for office verification" };
    if (status === "collected") return { icon: <CheckCircle2 size={14} />, badge: CX.badgeGreen, label: "Completed" };
    if (status === "rejected") return { icon: <XCircle size={14} />, badge: CX.badgeRed, label: "Rejected" };
    return { icon: <Clock3 size={14} />, badge: "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold text-amber-800 bg-amber-50 border border-amber-300/60", label: status === "pending" ? "Pending review" : status };
  }

  const visibleClaims = useMemo(
    () => claims.filter((c) => statusFilter === "all" || c.status === statusFilter),
    [claims, statusFilter],
  );

  return (
    <main className={CX.page}>
      {prompt}
      <div className={CX.inner}>

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <span className={CX.sectionLabel}>Ownership verification</span>
          <h1 className="mt-1 text-[30px] font-semibold text-navy-800 tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
            {activeTab === "submit" ? "Claim a found item" : "Claim history"}
          </h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            {activeTab === "submit"
              ? "Submit details and proof so an admin can verify your claim."
              : "Review the status of your submitted claims."}
          </p>
        </motion.div>

        <section className={`${CX.cardNavy} mb-6 p-5 md:p-6`}>
          <div className="flex items-start gap-3">
            <ShieldCheck size={20} className="mt-0.5 shrink-0 text-gold-300" />
            <div>
              <h2 className="text-[16px] font-semibold text-white">Before you submit</h2>
              <p className="mt-1 text-[13px] leading-5 text-white/75">Provide private ownership details and upload both ownership proof and a valid school or government ID. Online approval is not the final handover; bring your original ID to the UMAK Lost and Found Office.</p>
              <div className="mt-4 grid gap-2 border-t border-white/15 pt-3 text-[12px] text-white/85 sm:grid-cols-2">
                <p className="flex items-start gap-2"><MapPin size={14} className="mt-0.5 shrink-0 text-gold-300" /><span>Admin Building, Ground Floor, OHSO Office, or Security Office behind the Oval Stadium</span></p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="inline-flex items-center gap-1.5"><Phone size={13} className="text-gold-300" /><a href="tel:09478685684" className="underline">09478685684</a></span><span className="inline-flex items-center gap-1.5"><Mail size={13} className="text-gold-300" /><a href="mailto:ebaliksupport@gmail.com" className="underline">ebaliksupport@gmail.com</a></span></p>
              </div>
            </div>
          </div>
        </section>

        {/* Tab switcher */}
        <div className={`${CX.cardSm} flex gap-1 p-1.5 mb-6`}>
          {([["submit", "Submit claim"], ["history", `Claim history (${claims.length})`]] as const).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`flex-1 rounded-[12px] py-2.5 text-[13px] font-bold transition-colors duration-200 ${
                activeTab === t
                  ? "bg-navy-800 hover:bg-navy-700 text-white border"
                  : "text-ink-soft hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "submit" ? (
            <motion.section
              key="submit"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              {onNavigate && <VerificationGate action="file a claim" onNavigate={onNavigate} className="mb-5" />}
              <form onSubmit={submit} className={`${CX.card} flex flex-col gap-5 p-6 md:p-8`}>
                {error   && <div className={CX.alertError}>{error}</div>}

                {/* Reference */}
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-bold text-navy-800">Found item reference</label>
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Example: FP2031"
                    required
                    className={`${CX.input} h-[50px] w-full`}
                  />
                </div>

                {/* Which lost report this is (optional): it is completed together with the claim */}
                {myLostReports.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <label htmlFor="claim-lost-report" className="text-[12px] font-bold text-navy-800">Which of your lost reports is this? <span className="font-medium text-ink-muted">(optional)</span></label>
                    <select id="claim-lost-report" value={lostReportId} onChange={(e) => setLostReportId(e.target.value)} className={`${CX.input} h-[50px] w-full`}>
                      <option value="">Not linked to a report</option>
                      {myLostReports.map((report) => (
                        <option key={report.mpost_id} value={report.mpost_id}>{report.item_name} · {report.mpost_id}{report.last_location ? ` · ${report.last_location}` : ""}</option>
                      ))}
                    </select>
                    <p className="text-[12px] text-ink-muted">When the item is released to you, this report is marked Completed automatically.</p>
                  </div>
                )}

                {/* Reason */}
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-bold text-navy-800">Why do you believe this is your item?</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={5}
                    placeholder="Describe unique features, contents, serial numbers, or other proof of ownership."
                    required
                    className="rounded-xl border border-line-strong bg-slate-50 p-4 text-[14px] outline-none resize-none w-full focus:border-navy-600 transition-colors placeholder:text-slate-500"
                  />
                </div>

                {/* Proof upload */}
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-bold text-navy-800">Ownership photo proof</label>
                  <div
                    onClick={() => document.getElementById("claim-proof")?.click()}
                    className="cursor-pointer min-h-[160px] flex items-center justify-center rounded-[20px] border border-dashed border-gold-400/70 bg-[#fffbeb] hover:bg-[#fffdf0] hover:border-gold-400 transition-colors"
                  >
                    {proofPreview ? (
                      <img decoding="async" src={proofPreview} alt="Ownership proof preview" className="max-h-[180px] rounded-xl object-contain" />
                    ) : (
                      <div className="text-center flex flex-col items-center gap-3 py-6">
                        <div className="size-[52px] flex items-center justify-center rounded-[16px] bg-gold-500 hover:bg-gold-400 text-navy-800 border border-[#e8c070]/50">
                          <ImagePlus size={24} />
                        </div>
                        <p className="text-[14px] text-ink-muted font-medium">Choose an ownership photo</p>
                        <p className="text-[12px] text-slate-500">JPG, PNG, WEBP, or GIF accepted</p>
                      </div>
                    )}
                  </div>
                  <input id="claim-proof" type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => chooseProof(e.target.files?.[0])} />
                  <PhotoSourceButtons onFile={chooseProof} />
                  {proof && <p className="text-[12px] text-ink-muted">Selected: {proof.name}</p>}
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-bold text-navy-800">Valid ID document</label>
                  <select value={identityDocumentType} onChange={(event) => setIdentityDocumentType(event.target.value)} className={`${CX.input} h-[48px] w-full`}>
                    <option value="campus_id">UMAK student / campus ID</option>
                    <option value="government_id">Government-issued ID</option>
                    <option value="cor">Certificate of Registration (COR)</option>
                  </select>
                  <label htmlFor="claim-identity-document" className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-gold-400/70 bg-[#fffbeb] p-4 text-center hover:bg-[#fffdf0]">
                    {identityDocument ? <><FileText size={24} className="text-gold-700" /><span className="text-[13px] font-semibold text-navy-800">{identityDocument.name}</span><span className="text-[12px] text-ink-muted">Click to replace document</span></> : <><Upload size={22} className="text-gold-700" /><span className="text-[13px] font-semibold text-navy-800">Upload a clear photo or PDF of your ID</span><span className="text-[12px] text-ink-muted">JPG, PNG, WEBP, or PDF · 10 MB maximum</span></>}
                  </label>
                  <input id="claim-identity-document" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(event) => chooseIdentityDocument(event.target.files?.[0])} />
                  <PhotoSourceButtons allowPdf onFile={chooseIdentityDocument} />
                  <p className="text-[12px] leading-4 text-ink-muted">ID documents are private and available only to authorized administrators for claim review.</p>
                </div>

                {/* Submit */}
                <motion.button
                  type="submit"
                  disabled={isLoading}
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  transition={SPRING}
                  className={`${CX.btnNavy} flex items-center justify-center gap-2 h-[52px] w-full text-[15px]`}
                >
                  <Upload size={16} />
                  {isLoading ? "Submitting…" : "Submit claim"}
                </motion.button>
              </form>
            </motion.section>
          ) : (
            <motion.section
              key="history"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="min-w-0"
            >
              {/* Status filter tabs */}
              <div className={`${CX.cardSm} grid grid-cols-2 gap-1 p-1 mb-5 sm:grid-cols-5`}>
                {([
                  ["all",                "All"],
                  ["pending",            "Pending"],
                  ["approved_for_pickup", "Approved"],
                  ["rejected",           "Rejected"],
                  ["collected",          "Completed"],
                ] as const).map(([f, label]) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setStatusFilter(f)}
                    className={`min-w-0 rounded-[10px] px-2 py-2 text-[12px] font-bold transition-colors ${
                      statusFilter === f
                        ? f === "approved_for_pickup" || f === "collected" ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          : f === "rejected" ? "bg-red-100 text-red-800 border border-rose-200"
                          : f === "pending" ? "bg-amber-100 text-amber-800 border border-amber-200"
                          : "bg-navy-800 hover:bg-navy-700 text-white border"
                        : "text-ink-muted hover:bg-slate-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {claimsLoading ? <ReportGridSkeleton count={4} /> : <div className="grid gap-4 sm:grid-cols-2">
                {visibleClaims.length === 0 ? (
                  <div className={`${CX.card} sm:col-span-2 py-14 text-center`}>
                    <p className="text-[15px] font-bold text-ink-muted">
                      {claims.length === 0 ? "No claims submitted yet." : "No claims match this filter."}
                    </p>
                  </div>
                ) : visibleClaims.map((claim, i) => {
                  const st   = statusStyle(claim.status);
                  const item = claim.found_items;
                  return (
                    <motion.article
                      key={claim.claim_id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...SPRING, delay: i * 0.05 }}
                      className={`${CX.card} p-4`}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        {/* Proof thumb */}
                        <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 border border-white/60">
                          {claim.proof_image_url
                            ? <img decoding="async" src={claim.proof_image_url} alt="Submitted ownership proof" className="size-full object-contain" />
                            : <ImagePlus size={20} className="text-[#cbd5e1]" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1.5 flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between">
                            <h3 className="min-w-0 break-words text-[14px] font-semibold text-navy-800">
                              {item?.item_name || item?.fpost_id || "Found item"}
                            </h3>
                            <span className={`${st.badge} max-w-full whitespace-normal leading-tight sm:shrink-0`}>
                              {st.icon}{st.label}
                            </span>
                          </div>
                          <p className="break-words text-[12px] text-ink-muted">{item?.fpost_id || "Reference unavailable"} · {item?.category || "Uncategorized"}</p>
                          <p className="mt-1 break-all text-[12px] font-semibold text-ink-soft">Claim reference: {claim.claim_reference || claim.claim_id}</p>
                          <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-ink-soft">{claim.claim_reason}</p>
                          {claim.status === "rejected" && claim.rejection_reason && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] leading-4 text-red-800"><span className="font-bold">Review note:</span> {claim.rejection_reason}</p>}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[#eef2f7]">
                        <p className="text-[12px] text-slate-500">
                          Submitted {claim.created_at ? new Date(claim.created_at).toLocaleDateString() : "recently"}
                        </p>
                        {claim.status === "pending" && (
                          <button
                            type="button"
                            onClick={() => void cancel(claim.claim_id)}
                            disabled={isLoading}
                            className={`${CX.btnDanger} flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold disabled:opacity-60`}
                          >
                            <Trash2 size={12} /> Cancel
                          </button>
                        )}
                      </div>
                      {(claim.status === "approved_for_pickup" || claim.status === "approved") && (
                        <div className="mt-3 rounded-[12px] border border-emerald-200 bg-emerald-50 p-3 text-[12px] leading-5 text-emerald-900">
                          {claim.handover_pin && (
                            <div className="mb-3 rounded-[12px] border-2 border-dashed border-[#d1a153] bg-[#1f3160] px-3 py-3 text-center" aria-label="Your Handover PIN">
                              <p className="text-[11px] font-bold tracking-[0.14em] text-[#ecc787]">YOUR HANDOVER PIN</p>
                              <p className="mt-1 select-all font-mono text-[30px] font-bold leading-none tracking-[0.28em] text-[#ffffff]">{claim.handover_pin}</p>
                              <HandoverQr claimId={claim.claim_id} />
                              <p className="mt-2 text-[11.5px] leading-4 text-[#b9c3dc]">Show this PIN and your original ID to the guard. It works once, and only for this item. Keep it private.</p>
                            </div>
                          )}
                          <p className="font-bold">Approved for office verification. Bring your original ID and claim reference.</p>
                          <p className="mt-1">Admin Building, Ground Floor, OHSO Office, or Security Office behind the Oval Stadium.</p>
                          <p className="mt-1"><a href="tel:09478685684" className="underline">09478685684</a> · <a href="mailto:ebaliksupport@gmail.com" className="underline">ebaliksupport@gmail.com</a></p>
                        </div>
                      )}
                    </motion.article>
                  );
                })}
              </div>}
            </motion.section>
          )}
        </AnimatePresence>

        <Modal
          open={confirmationOpen}
          onClose={() => setConfirmationOpen(false)}
          dismissible={!isLoading && !submitting}
          size="sm"
          tone="gold"
          icon={<ShieldCheck size={21} />}
          eyebrow="Final review"
          title="Confirm your claim"
          description="Authorized administrators will review your claim and ID. If approved, bring your original ID to the UMak Lost and Found Office. Online approval doesn't release the item."
          footer={
            <>
              <button type="button" disabled={isLoading || submitting} onClick={() => setConfirmationOpen(false)} className={CX.btnGhost}>Cancel</button>
              <button type="button" disabled={countdown > 0 || !truthConfirmed || !privacy || isLoading || submitting} onClick={() => void confirmSubmission()} className={CX.btnGold}>{isLoading || submitting ? "Submitting…" : "Confirm claim"}</button>
            </>
          }
        >
          <CountdownConsent
            countdown={countdown}
            checked={truthConfirmed}
            onCheckedChange={setTruthConfirmed}
            label="I confirm that the information and documents are truthful, and understand that final item release requires in-person verification."
          />
          <div className="mt-3"><DataPrivacyConsent checked={privacy} onChange={setPrivacy} disabled={countdown > 0} purpose="process your claim and verify your identity and ownership" /></div>
        </Modal>

      </div>
    </main>
  );
}
