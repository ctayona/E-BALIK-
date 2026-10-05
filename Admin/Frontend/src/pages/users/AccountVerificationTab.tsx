import { useState } from "react";
import { BadgeCheck, Briefcase, Check, ExternalLink, FileCheck2, GraduationCap, RefreshCw, UserRound, X } from "lucide-react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, Field, SelectInput, TextArea } from "../../components/ui/primitives";
import { StatusPill } from "../../components/ui/management";
import { reviewAdminAccountVerification, type AdminAccountVerificationRequest } from "../../utils/api";

import { tr } from "../../utils/preferences";
export const VERIFICATION_ROLES = [
  { value: "Student", icon: GraduationCap, hint: "Enrolled UMak student" },
  { value: "Faculty", icon: BadgeCheck, hint: "Teaching staff" },
  { value: "Staff", icon: Briefcase, hint: "Non-teaching personnel" },
  { value: "Visitor", icon: UserRound, hint: "Guest or alumni" },
] as const;

interface AccountVerificationTabProps {
  requests: AdminAccountVerificationRequest[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onReviewed: () => void;
}

export default function AccountVerificationTab({ requests, loading, error, onRefresh, onReviewed }: AccountVerificationTabProps) {
  const [reviewTarget, setReviewTarget] = useState<AdminAccountVerificationRequest | null>(null);
  const [decision, setDecision] = useState<"verified" | "rejected">("verified");
  const [identityRole, setIdentityRole] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const beginReview = (request: AdminAccountVerificationRequest, nextDecision: "verified" | "rejected") => {
    setReviewTarget(request);
    setDecision(nextDecision);
    setIdentityRole(VERIFICATION_ROLES.some((role) => role.value === request.user_role) ? request.user_role : "");
    setReviewNote("");
    setReviewError("");
  };

  const confirmReview = async () => {
    if (!reviewTarget || busy) return;
    setBusy(true);
    setReviewError("");
    try {
      await reviewAdminAccountVerification(reviewTarget.account_id, decision, identityRole, reviewNote);
      setConfirmOpen(false);
      setReviewTarget(null);
      onReviewed();
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : tr("Unable to update this verification request."));
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-heading)] text-[18px] font-semibold text-ink">{tr("Account verification")}</h2>
          <p className="text-sm text-slate-500">{tr("Review identity documents. Verifying an account means assigning it a role.")}</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className={BTN.ghost}>
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh requests
        </button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {reviewError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{reviewError}</div>}

      {loading ? (
        <div className="glass-panel p-8 text-center text-sm text-ink-muted" aria-busy="true">{tr("Loading verification requests...")}</div>
      ) : requests.length === 0 ? (
        <div className="glass-panel px-6 py-14 text-center">
          <FileCheck2 size={30} className="mx-auto text-emerald-700" />
          <p className="mt-3 font-semibold text-slate-800">{tr("No pending verification requests")}</p>
          <p className="mt-1 text-sm text-slate-500">{tr("New document submissions will appear here.")}</p>
        </div>
      ) : (
        <div className="glass-panel divide-y divide-line overflow-hidden">
          {requests.map((request) => (
            <article key={request.account_id} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-900">{request.name || tr("Unnamed account")}</h3>
                  <StatusPill tone="gold">{tr("Pending review")}</StatusPill>
                </div>
                <p className="mt-1 break-all text-sm text-slate-600">{request.email}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>{tr("Campus ID: {0}", { "0": request.campus_id || "N/A" })}</span>
                  <span>{tr("Signed up as: {0}", { "0": tr(request.user_role || "Others") })}</span>
                  <span>{tr("Access:")} {request.access_level === "super_admin" ? tr("Superadmin") : request.access_level === "admin" ? tr("Admin") : tr("User")}</span>
                </div>
                <p className="mt-2 text-xs text-slate-600">{request.document_type}: <span className="font-semibold">{request.document_name}</span></p>
                <p className="mt-1 text-xs text-slate-400">{tr("Submitted {0}", { "0": request.uploaded_at ? new Date(request.uploaded_at).toLocaleString() : tr("date unavailable") })}</p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {request.document_url ? <a href={request.document_url} target="_blank" rel="noreferrer" className={BTN.ghost}><ExternalLink size={15} /> {tr("View document")}</a> : <span className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{tr("Document preview unavailable")}</span>}
                <button type="button" onClick={() => beginReview(request, "rejected")} className={BTN.ghost}><X size={15} /> {tr("Reject")}</button>
                <button type="button" onClick={() => beginReview(request, "verified")} className={BTN.success}><Check size={15} /> {tr("Verify")}</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {reviewTarget && (
        <AdminModal
          title={decision === "verified" ? tr("Verify identity") : tr("Reject document")}
          description={`${reviewTarget.name || tr("Unnamed account")}, ${reviewTarget.email}`}
          icon={decision === "verified" ? <Check size={20} /> : <X size={20} />}
          tone={decision === "verified" ? "mint" : "danger"}
          busy={busy}
          onClose={() => setReviewTarget(null)}
          footer={<>
            <button type="button" onClick={() => setReviewTarget(null)} className={BTN.ghost}>{tr("Cancel")}</button>
            <button type="button" onClick={() => { if (decision === "rejected" && !reviewNote.trim()) { setReviewError(tr("A reason is required when rejecting a document.")); return; } if (decision === "verified" && !identityRole) { setReviewError(tr("Choose a role before verifying this account.")); return; } setReviewError(""); setConfirmOpen(true); }} className={decision === "rejected" ? BTN.danger : BTN.success}>{tr("Continue")}</button>
          </>}
        >
          {decision === "verified" ? (
            <fieldset>
              <legend className="mb-1 text-[14px] font-semibold text-ink-soft">{tr("Assign a role")}<span className="text-rose-600"> *</span></legend>
              <p className="mb-3 text-[13px] leading-5 text-ink-muted">{tr("Every verified account needs a role. It shows on the user's profile and does not change admin access.")}</p>
              <div className="grid grid-cols-2 gap-2.5">
                {VERIFICATION_ROLES.map(({ value, icon: Icon, hint }, index) => {
                  const active = identityRole === value;
                  return (
                    <label key={value} className={`relative flex cursor-pointer flex-col gap-1 rounded-2xl border p-3.5 transition focus-within:ring-4 focus-within:ring-iris-500/20 ${active ? "border-gold-500 bg-gold-50 shadow-[0_8px_22px_-14px_rgba(185,135,58,0.9)] dark:bg-gold-500/10" : "border-line-strong bg-[var(--surface)] hover:border-iris-300"}`}>
                      <input type="radio" name="verification-role" value={value} checked={active} onChange={() => setIdentityRole(value)} data-autofocus={index === 0 ? true : undefined} className="sr-only" />
                      <span className={`flex size-9 items-center justify-center rounded-xl ${active ? "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" : "bg-frost-100 text-ink-soft"}`}><Icon size={18} aria-hidden="true" /></span>
                      <span className="text-[15px] font-semibold text-ink">{tr(value)}</span>
                      <span className="text-[12.5px] leading-4 text-ink-muted">{tr(hint)}</span>
                      {active && <Check size={16} className="absolute right-3 top-3 text-gold-700" aria-hidden="true" />}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <Field label={tr("Reason for rejection")} required hint={tr("The user sees this note.")}>{(id) => (
              <TextArea id={id} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} rows={3} maxLength={500} placeholder={tr("The ID photo is blurry. Upload a clear photo of the front.")} data-autofocus />
            )}</Field>
          )}
          {reviewError && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{reviewError}</p>}
        </AdminModal>
      )}

      {confirmOpen && <ConfirmActionDialog
        title={decision === "verified" ? tr("approve this identity verification") : tr("reject this verification request")}
        description={decision === "verified" ? tr("This verifies {0} as {1}. Admin access is unchanged.", { "0": reviewTarget?.name || tr("the account"), "1": identityRole }) : tr("This rejects the document for {0}. The user will see your review note.", { "0": reviewTarget?.name || tr("the account") })}
        confirmLabel={decision === "verified" ? tr("Verify account") : tr("Reject request")}
        danger={decision === "rejected"}
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirmReview()}
      />}
    </section>
  );
}
