import { useState } from "react";
import { Check, ExternalLink, FileCheck2, RefreshCw, X } from "lucide-react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { reviewAdminAccountVerification, type AdminAccountVerificationRequest } from "../../utils/api";

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
      setReviewError(requestError instanceof Error ? requestError.message : "Unable to update this verification request.");
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Account Verification</h2>
          <p className="text-sm text-slate-500">Review submitted identity documents and confirm the account category.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh requests
        </button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {reviewError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{reviewError}</div>}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500" aria-busy="true">Loading verification requests...</div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-14 text-center">
          <FileCheck2 size={30} className="mx-auto text-emerald-700" />
          <p className="mt-3 font-semibold text-slate-800">No pending verification requests</p>
          <p className="mt-1 text-sm text-slate-500">New document submissions will appear here.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {requests.map((request) => (
            <article key={request.account_id} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-900">{request.name || "Unnamed account"}</h3>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[12px] font-bold text-amber-900">Pending review</span>
                </div>
                <p className="mt-1 break-all text-sm text-slate-600">{request.email}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Campus ID: {request.campus_id || "N/A"}</span>
                  <span>Current category: {request.user_role || "Others"}</span>
                  <span>Access: {request.access_level === "super_admin" ? "Superadmin" : request.access_level === "admin" ? "Admin" : "User"}</span>
                </div>
                <p className="mt-2 text-xs text-slate-600">{request.document_type}: <span className="font-semibold">{request.document_name}</span></p>
                <p className="mt-1 text-xs text-slate-400">Submitted {request.uploaded_at ? new Date(request.uploaded_at).toLocaleString() : "date unavailable"}</p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {request.document_url ? <a href={request.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ExternalLink size={15} /> View document</a> : <span className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">Document preview unavailable</span>}
                <button type="button" onClick={() => beginReview(request, "rejected")} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"><X size={15} /> Reject</button>
                <button type="button" onClick={() => beginReview(request, "verified")} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"><Check size={15} /> Verify</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {reviewTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="verification-review-title" className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Account verification</p>
            <h2 id="verification-review-title" className="mt-1 text-xl font-bold text-slate-900">{decision === "verified" ? "Verify identity" : "Reject document"}</h2>
            <p className="mt-2 break-all text-sm text-slate-600">{reviewTarget.name} · {reviewTarget.email}</p>
            {decision === "verified" ? (
              <div className="mt-4">
                <label htmlFor="identity-category" className="mb-1 block text-sm font-semibold text-slate-700">Assign identity category</label>
                <select id="identity-category" value={identityRole} onChange={(event) => setIdentityRole(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm">
                  <option value="Student">Student</option>
                  <option value="Faculty">Faculty</option>
                  <option value="Others">Others</option>
                </select>
                <p className="mt-2 text-xs text-slate-500">This changes the account identity category only, not Admin or Superadmin access.</p>
              </div>
            ) : (
              <div className="mt-4">
                <label htmlFor="verification-review-note" className="mb-1 block text-sm font-semibold text-slate-700">Reason for rejection</label>
                <textarea id="verification-review-note" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} rows={3} maxLength={500} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" placeholder="Explain what document or information needs correction" />
              </div>
            )}
            {reviewError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{reviewError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setReviewTarget(null)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => { if (decision === "rejected" && !reviewNote.trim()) { setReviewError("A reason is required when rejecting a document."); return; } setReviewError(""); setConfirmOpen(true); }} className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white ${decision === "rejected" ? "bg-rose-700 hover:bg-rose-800" : "bg-emerald-700 hover:bg-emerald-800"}`}>Continue</button>
            </div>
          </section>
        </div>
      )}

      {confirmOpen && <ConfirmActionDialog
        title={decision === "verified" ? "approve this identity verification" : "reject this verification request"}
        description={decision === "verified" ? `This verifies ${reviewTarget?.name || "the account"} as ${identityRole}. Admin access is unchanged.` : `This rejects the document for ${reviewTarget?.name || "the account"}. The user will see your review note.`}
        confirmLabel={decision === "verified" ? "Verify account" : "Reject request"}
        danger={decision === "rejected"}
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirmReview()}
      />}
    </section>
  );
}
