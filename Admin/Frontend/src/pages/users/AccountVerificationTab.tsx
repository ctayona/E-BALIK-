import { useState } from "react";
import { Check, ExternalLink, FileCheck2, RefreshCw, X } from "lucide-react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import AdminModal from "../../components/ui/AdminModal";
import { BTN, Field, SelectInput, TextArea } from "../../components/ui/primitives";
import { StatusPill } from "../../components/ui/management";
import { reviewAdminAccountVerification, type AdminAccountVerificationRequest } from "../../utils/api";

import { tr } from "../../utils/preferences";
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
  const [identityRole, setIdentityRole] = useState("Student");
  const [reviewNote, setReviewNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const beginReview = (request: AdminAccountVerificationRequest, nextDecision: "verified" | "rejected") => {
    setReviewTarget(request);
    setDecision(nextDecision);
    setIdentityRole(["Student", "Faculty", "Others"].includes(request.user_role) ? request.user_role : "Student");
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
          <p className="text-sm text-slate-500">{tr("Review submitted identity documents and confirm the account category.")}</p>
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
                  <span>{tr("Current category: {0}", { "0": tr(request.user_role || "Others") })}</span>
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
            <button type="button" onClick={() => { if (decision === "rejected" && !reviewNote.trim()) { setReviewError(tr("A reason is required when rejecting a document.")); return; } setReviewError(""); setConfirmOpen(true); }} className={decision === "rejected" ? BTN.danger : BTN.success}>{tr("Continue")}</button>
          </>}
        >
          {decision === "verified" ? (
            <Field label={tr("Identity category")} hint={tr("This changes the account's identity category only, not admin access.")}>{(id) => (
              <SelectInput id={id} value={identityRole} onChange={(event) => setIdentityRole(event.target.value)} data-autofocus>
                <option value="Student">{tr("Student")}</option>
                <option value="Faculty">{tr("Faculty")}</option>
                <option value="Others">{tr("Others")}</option>
              </SelectInput>
            )}</Field>
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
