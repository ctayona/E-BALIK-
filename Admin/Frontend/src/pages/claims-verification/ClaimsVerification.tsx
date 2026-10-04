import { useEffect, useState } from "react";
import type { Claim } from "../../data/mockData";
import { deleteAdminClaim, fetchAdminClaimHistory, fetchAdminClaims, getStoredAdmin, updateAdminClaimStatus, type AdminClaimHistoryRow, type AdminClaimRow } from "../../utils/api";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { showInfoModal } from "../../components/info-modal/infoModalStore";

function StatusBadge({ status }: { status: Claim["status"] }) {
  const map: Record<Claim["status"], { bg: string; text: string; dot: string }> = {
    "Under Review": { bg: "#fffbeb", text: "#d97706", dot: "#f59e0b" },
    Pending: { bg: "#eff6ff", text: "#2563eb", dot: "#60a5fa" },
    Verified: { bg: "#ecfdf5", text: "#059669", dot: "#10b981" },
    Approved: { bg: "#ecfdf5", text: "#059669", dot: "#10b981" },
    "Approved for Pickup": { bg: "#ecfdf5", text: "#047857", dot: "#10b981" },
    Collected: { bg: "#f0fdf4", text: "#15803d", dot: "#22c55e" },
    Rejected: { bg: "#fef2f2", text: "#dc2626", dot: "#ef4444" },
    Unknown: { bg: "#f3f4f6", text: "#4b5563", dot: "#9ca3af" },
  };
  const badge = map[status];

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: badge.bg, color: badge.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: badge.dot }} />
      {status}
    </span>
  );
}

interface ReviewModalProps {
  claim: Claim;
  onClose: () => void;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onCollect: (id: string) => Promise<void>;
}

function ReviewModal({ claim, onClose, onApprove, onReject, onCollect }: ReviewModalProps) {
  const isPending = claim.status === "Under Review" || claim.status === "Pending";
  const isApprovedForPickup = claim.status === "Approved for Pickup" || claim.status === "Approved";
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [decisionState, setDecisionState] = useState<{ type: "approved" | "rejected" | "error"; message: string } | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | "collect" | null>(null);
  const [confirmValue, setConfirmValue] = useState("");

  const itemDescription = claim.itemDescription || "No description provided for this item.";
  const claimReason = claim.claimReason || "No additional reason was provided by the claimant.";

  const closeConfirm = () => {
    setConfirmAction(null);
    setConfirmValue("");
  };

  const handleApprove = async () => {
    if (confirmAction !== "approve") {
      setConfirmAction("approve");
      setConfirmValue("");
      return;
    }
    if (confirmValue !== "CONFIRM") {
      setDecisionState({ type: "error", message: "Type CONFIRM to approve this claim." });
      return;
    }

    try {
      await onApprove(claim.id);
      closeConfirm();
      onClose();
    } catch {
      // Failure was already reported through the global modal; keep the dialog open for another attempt.
      closeConfirm();
    }
  };

  const handleReject = async () => {
    if (confirmAction !== "reject") {
      setConfirmAction("reject");
      setConfirmValue("");
      return;
    }
    if (!rejectionReason.trim()) {
      setDecisionState({ type: "error", message: "Enter a reason so the claimant knows what needs attention." });
      closeConfirm();
      return;
    }
    if (confirmValue !== "CONFIRM") {
      setDecisionState({ type: "error", message: "Type CONFIRM to reject this claim." });
      return;
    }

    try {
      await onReject(claim.id, rejectionReason);
      closeConfirm();
      onClose();
    } catch {
      // Failure was already reported through the global modal; keep the dialog open for another attempt.
      closeConfirm();
    }
  };

  const handleCollect = async () => {
    if (confirmAction !== "collect") {
      setConfirmAction("collect");
      setConfirmValue("");
      return;
    }
    if (confirmValue !== "CONFIRM") {
      setDecisionState({ type: "error", message: "Type CONFIRM to record collection." });
      return;
    }

    try {
      await onCollect(claim.id);
      closeConfirm();
      onClose();
    } catch {
      // Failure was already reported through the global modal; keep the dialog open for another attempt.
      closeConfirm();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.6)" }}>
      <div className="mx-4 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border border-line bg-white shadow-overlay">
        <div className="flex items-center justify-between border-b border-line bg-gradient-to-r from-slate-900 via-[#1d2f67] to-[#1f6c7f] px-6 py-5 text-white">
          <div>
            <div className="text-[12px] font-medium uppercase tracking-[0.18em] text-slate-200">Claim {claim.claimReference || claim.id}</div>
            <h2 className="mt-1 text-xl font-bold">Claim Review</h2>
          </div>
          <button onClick={onClose} className="rounded-full border border-white/20 bg-white/5 p-2 text-white transition hover:bg-white/10" aria-label="Close review dialog">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {decisionState && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                decisionState.type === "approved"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : decisionState.type === "rejected"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {decisionState.message}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-xl border border-line bg-slate-50 p-3">
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Claimant</div>
              <div className="font-semibold text-slate-900">{claim.claimant}</div>
              <div className="mt-1 text-xs text-slate-500">{claim.studentId}</div>
              {claim.claimantEmail && <div className="mt-2 break-all text-xs text-slate-600">{claim.claimantEmail}</div>}
            </div>
            <div className="rounded-xl border border-line bg-slate-50 p-3">
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Item Claimed</div>
              <div className="font-semibold text-slate-900">{claim.item}</div>
              <div className="mt-1 text-xs text-slate-500">{claim.itemId}</div>
            </div>
            <div className="rounded-xl border border-line bg-slate-50 p-3">
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Submitted</div>
              <div className="font-semibold text-slate-900">{claim.submitted}</div>
            </div>
            <div className="rounded-xl border border-line bg-slate-50 p-3">
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Claim status</div>
              <StatusBadge status={claim.status} />
            </div>
          </div>

          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <span className="font-semibold">Verification checklist:</span> Confirm student ID matches, review the item record, inspect the proof and item photos, and verify ownership before approval.
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Found item details</div>
              <p className="text-sm text-slate-700">{[claim.itemCategory, claim.itemLocation, claim.itemFoundDate].filter(Boolean).join(" · ") || "Details unavailable"}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Item description</div>
              <p className="text-sm leading-6 text-slate-700">{itemDescription}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Claim reason</div>
              <p className="text-sm leading-6 text-slate-700">{claimReason}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-red-500">Claim proof</span>
              </div>
              {claim.proofImage ? (
                <img src={claim.proofImage} alt="Claim proof" className="h-64 w-full cursor-zoom-in rounded-lg border border-line object-cover" onClick={() => setZoomedImage(claim.proofImage ?? null)} />
              ) : (
                <div className="flex h-64 w-full items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-slate-400">No proof image</div>
              )}
            </div>

            <div className="rounded-xl border border-line bg-white p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">Claimant ID · {claim.identityDocumentType || "Identity document"}</div>
              {claim.identityDocument ? (
                <a href={claim.identityDocument} target="_blank" rel="noreferrer" className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-blue-100 bg-blue-50 text-sm font-semibold text-blue-800 hover:bg-blue-100">
                  <span>Open private ID document</span>
                  <span className="text-xs font-normal">Temporary secure link</span>
                </a>
              ) : (
                <div className="flex h-64 w-full items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-slate-400">No ID document</div>
              )}
            </div>

            <div className="rounded-xl border border-line bg-white p-3 md:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Found item</span>
              </div>
              {claim.foundImage ? (
                <img src={claim.foundImage} alt="Found item" className="h-64 w-full cursor-zoom-in rounded-lg border border-line object-cover" onClick={() => setZoomedImage(claim.foundImage ?? null)} />
              ) : (
                <div className="flex h-64 w-full items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-slate-400">No item image</div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-line bg-slate-50 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <StatusBadge status={claim.status} />
            {isPending ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                  <button onClick={() => { setConfirmAction("reject"); setConfirmValue(""); }} className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
                    Reject Claim
                  </button>

                  <button
                    onClick={() => { setConfirmAction("approve"); setConfirmValue(""); }}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95"
                    style={{ background: "#0f766e" }}
                  >
                    Approve for Office
                  </button>
              </div>
            ) : isApprovedForPickup ? (
              <button onClick={() => { setConfirmAction("collect"); setConfirmValue(""); }} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">Record In-Person Collection</button>
            ) : (
              <button onClick={onClose} className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">Close</button>
            )}
          </div>
        </div>
      </div>

      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/65 p-4">
          <div className="w-full max-w-md rounded-[20px] border border-line bg-white p-5 shadow-overlay">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Confirmation required</div>
            <h3 className="text-lg font-bold text-slate-900">
              Are you sure? {confirmAction === "approve" ? "Approve claim for pickup" : confirmAction === "reject" ? "Reject this claim" : "Record collection"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {confirmAction === "approve"
                ? "Double-check the claim details. This approves the claimant for office verification and sends a notice to the user."
                : confirmAction === "reject"
                  ? "Double-check the claim details. This rejects the claim and enters a rejection reason for the user."
                  : "Double-check the claimant's original ID and confirm the item was physically handed over. This closes the found report and this claim, resolves any confirmed matching missing report belonging to this claimant, and closes competing claims for the same item."}
            </p>
            {confirmAction === "reject" && (
              <div className="mt-4">
                <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Reason for rejection</label>
                <textarea
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder="Explain what needs attention"
                  rows={3}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                />
              </div>
            )}
            <div className="mt-4">
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Type CONFIRM</label>
              <input
                value={confirmValue}
                onChange={(event) => setConfirmValue(event.target.value)}
                placeholder="CONFIRM"
                className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={closeConfirm} className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button
                onClick={confirmAction === "approve" ? handleApprove : confirmAction === "reject" ? handleReject : handleCollect}
                disabled={confirmValue !== "CONFIRM" || (confirmAction === "reject" && !rejectionReason.trim())}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: confirmAction === "reject" ? "#dc2626" : confirmAction === "collect" ? "#15803d" : "#0f766e" }}
              >
                {confirmAction === "approve" ? "Approve" : confirmAction === "reject" ? "Reject" : "Confirm collection"}
              </button>
            </div>
          </div>
        </div>
      )}

      {zoomedImage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" onClick={() => setZoomedImage(null)}>
          <div className="relative max-h-[90vh] w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <button onClick={() => setZoomedImage(null)} className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg">×</button>
            <img src={zoomedImage} alt="Zoomed comparison" className="max-h-[90vh] w-full rounded-xl bg-white object-contain p-2" />
          </div>
        </div>
      )}
    </div>
  );
}

function claimHistorySummary(entry: AdminClaimHistoryRow): string {
  if (entry.action === "created") return "Claim submitted";
  if (entry.action === "deleted") return "Claim deleted by Superadmin";

  const labels: Record<string, string> = {
    status: "Status",
    rejection_reason: "Rejection reason",
    reviewed_at: "Review date",
    collected_at: "Collection date",
    pickup_deadline: "Pickup deadline",
  };
  const fields = Object.entries(labels).flatMap(([key, label]) => {
    const oldValue = entry.oldValues?.[key];
    const newValue = entry.newValues?.[key];
    if (oldValue === newValue || (oldValue == null && newValue == null)) return [];
    if (key === "status") {
      return [`${label}: ${String(oldValue ?? "None").replace(/_/g, " ")} → ${String(newValue ?? "None").replace(/_/g, " ")}`];
    }
    if (key === "rejection_reason") return [`${label}: ${String(newValue || "Removed")}`];
    return [`${label} updated`];
  });

  return fields.join(" · ") || "Claim details updated";
}

export default function ClaimsVerification() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [history, setHistory] = useState<AdminClaimHistoryRow[]>([]);
  const [reviewClaim, setReviewClaim] = useState<Claim | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [activeTab, setActiveTab] = useState<"claims" | "all" | "closed" | "history">("claims");
  const [claimantFilter, setClaimantFilter] = useState("");
  const [foundItemFilter, setFoundItemFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | Claim["status"]>("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateOrder, setDateOrder] = useState<"newest" | "oldest">("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Claim | null>(null);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [collectionTarget, setCollectionTarget] = useState<Claim | null>(null);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const isSuperAdmin = getStoredAdmin()?.access_level === "super_admin";
  const pageSize = 10;

  const normalizeClaimStatus = (status: string | null | undefined): Claim["status"] => {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "approved_for_pickup" || normalized === "approved for pickup" || normalized === "approved" || normalized === "verified" || normalized === "accepted") {
      return "Approved for Pickup";
    }
    if (normalized === "collected") return "Collected";
    if (normalized === "rejected" || normalized === "declined" || normalized === "denied") return "Rejected";
    if (normalized === "pending" || normalized === "under review" || normalized === "under_review" || normalized === "in_review" || normalized === "review") return "Under Review";
    return "Unknown";
  };

  const mapClaims = (data: AdminClaimRow[]): Claim[] =>
    data.map((item) => ({
      id: item.id,
      claimReference: item.claimReference || item.id,
      foundItemId: item.foundItemId || "",
      claimant: item.claimant,
      studentId: item.studentId,
      item: item.item,
      itemId: item.itemId,
      itemDescription: item.itemDescription,
      claimReason: item.claimReason,
      proofImage: item.proofImage,
      identityDocument: item.identityDocument,
      identityDocumentType: item.identityDocumentType,
      rejectionReason: item.rejectionReason,
      claimantEmail: item.claimantEmail,
      itemCategory: item.itemCategory,
      itemLocation: item.itemLocation,
      itemFoundDate: item.itemFoundDate,
      foundImage: item.foundImage,
      submitted: item.submitted ? new Date(item.submitted).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Unknown",
      submittedAt: item.submittedAt || item.submitted,
      status: normalizeClaimStatus(item.status),
    }));

  const refreshClaims = async (): Promise<Claim[]> => {
    try {
      const data = await fetchAdminClaims();
      const mappedClaims = mapClaims(data);
      setClaims(mappedClaims);
      setReviewClaim((current) => current ? mappedClaims.find((claim) => claim.id === current.id) ?? current : current);
      setLoadError("");
      return mappedClaims;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load claims.";
      setLoadError(message);
      throw error;
    }
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const data = await fetchAdminClaims();
        if (!active) return;
        const mappedClaims = mapClaims(data);
        setClaims(mappedClaims);
        setReviewClaim((current) => current ? mappedClaims.find((claim) => claim.id === current.id) ?? current : current);
        setLoadError("");
      } catch (error) {
        if (!active) return;
        setClaims([]);
        setLoadError(error instanceof Error ? error.message : "Unable to load claims.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    const handleClaimsUpdated = () => {
      void load();
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void load();
    };

    window.addEventListener("ebalik-claims-updated", handleClaimsUpdated);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const refreshInterval = window.setInterval(refreshWhenVisible, 15000);

    return () => {
      active = false;
      window.removeEventListener("ebalik-claims-updated", handleClaimsUpdated);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(refreshInterval);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "history") return;
    let active = true;

    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const records = await fetchAdminClaimHistory();
        if (!active) return;
        setHistory(records);
        setHistoryError("");
      } catch (error) {
        if (!active) return;
        setHistoryError(error instanceof Error ? error.message : "Unable to load claim history.");
      } finally {
        if (active) setHistoryLoading(false);
      }
    };

    const refreshHistory = () => void loadHistory();
    void loadHistory();
    window.addEventListener("ebalik-claims-updated", refreshHistory);

    return () => {
      active = false;
      window.removeEventListener("ebalik-claims-updated", refreshHistory);
    };
  }, [activeTab]);

  const claimantValue = claimantFilter.trim().toLocaleLowerCase();
  const foundItemValue = foundItemFilter.trim().toLocaleLowerCase();
  const dateRangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const closedClaims = claims.filter((claim) => claim.status === "Collected" || claim.status === "Rejected");
  const activeClaims = claims.filter((claim) => claim.status !== "Collected" && claim.status !== "Rejected");
  const tabClaims = activeTab === "claims" ? claims : activeTab === "closed" ? closedClaims : activeClaims;
  const filteredClaims = tabClaims.filter((claim) => {
    if (statusFilter !== "All" && claim.status !== statusFilter) return false;
    if (claimantValue && !claim.claimant.toLocaleLowerCase().includes(claimantValue)) return false;
    if (foundItemValue && ![claim.foundItemId, claim.itemId].some((value) => (value || "").toLocaleLowerCase().includes(foundItemValue))) return false;

    if (dateFrom || dateTo) {
      const submittedDate = new Date(claim.submittedAt || "");
      if (Number.isNaN(submittedDate.getTime())) return false;
      const localDate = [submittedDate.getFullYear(), String(submittedDate.getMonth() + 1).padStart(2, "0"), String(submittedDate.getDate()).padStart(2, "0")].join("-");
      if (dateFrom && localDate < dateFrom) return false;
      if (dateTo && localDate > dateTo) return false;
    }

    return true;
  }).sort((first, second) => {
    const firstDate = new Date(first.submittedAt || "").getTime() || 0;
    const secondDate = new Date(second.submittedAt || "").getTime() || 0;
    return dateOrder === "newest" ? secondDate - firstDate : firstDate - secondDate;
  });
  const totalPages = Math.max(1, Math.ceil(filteredClaims.length / pageSize));
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);
  const boundedPage = Math.min(currentPage, totalPages);
  const visibleClaims = filteredClaims.slice((boundedPage - 1) * pageSize, boundedPage * pageSize);
  const pageWindowStart = Math.max(1, Math.min(boundedPage - 2, totalPages - 5));
  const pageNumbers = Array.from({ length: Math.min(6, totalPages) }, (_, index) => pageWindowStart + index);
  const availableStatuses: Claim["status"][] = ["Under Review", "Approved for Pickup", "Rejected", "Collected", "Unknown"];

  const clearFilters = () => {
    setClaimantFilter("");
    setFoundItemFilter("");
    setStatusFilter("All");
    setDateFrom("");
    setDateTo("");
    setDateOrder("newest");
    setCurrentPage(1);
  };

  const setFilter = (update: () => void) => {
    update();
    setCurrentPage(1);
  };

  const approve = async (id: string) => {
    const targetClaim = claims.find((entry) => entry.id === id);
    if (targetClaim && (targetClaim.status === "Approved for Pickup" || targetClaim.status === "Collected" || targetClaim.status === "Rejected")) {
      showInfoModal({ variant: "warning", title: "Claim already processed", message: "This claim has already been processed and can only move to collection or remain rejected." });
      return;
    }

    try {
      await updateAdminClaimStatus(id, "approved_for_pickup");
      setClaims((current) => current.map((claim) => claim.id === id ? { ...claim, status: "Approved for Pickup" } : claim));
      setReviewClaim(null);
      setActiveTab("all");
      setStatusFilter("Approved for Pickup");
      setCurrentPage(1);
      try {
        await refreshClaims();
      } catch {
      }
      showInfoModal({ variant: "success", title: "Claim approved for pickup", message: "The claimant can now complete in-person ownership verification at the office.", replaceAuto: true });
      window.dispatchEvent(new CustomEvent("ebalik-claims-updated"));
    } catch (error) {
      try {
        const latestClaims = await refreshClaims();
        if (latestClaims.some((claim) => claim.id === id && claim.status === "Approved for Pickup")) {
          setReviewClaim(null);
          setActiveTab("all");
          setStatusFilter("Approved for Pickup");
          setCurrentPage(1);
          showInfoModal({ variant: "info", title: "Claim was already approved", message: "This claim was already approved. The admin list is now synchronized.", replaceAuto: true });
          return;
        }
      } catch {
      }
      throw error;
    }
  };

  const reject = async (id: string, reason: string) => {
    await updateAdminClaimStatus(id, "rejected", reason);
    await refreshClaims();
    setReviewClaim(null);
    setActiveTab("history");
    setStatusFilter("Rejected");
    showInfoModal({ variant: "success", title: "Claim rejected", message: "The status is now Rejected and the claim moved to Claim History.", replaceAuto: true });
    window.dispatchEvent(new CustomEvent("ebalik-claims-updated"));
  };

  const collect = async (id: string) => {
    await updateAdminClaimStatus(id, "collected");
    await refreshClaims();
    setReviewClaim(null);
    setActiveTab("closed");
    setStatusFilter("All");
    setCurrentPage(1);
    showInfoModal({
      variant: "success",
      title: "Collection recorded",
      message: "The found report and claim are closed.",
      details: ["Any confirmed matching missing report for this claimant is resolved.", "Competing claims for the same item are closed."],
      replaceAuto: true,
    });
    window.dispatchEvent(new CustomEvent("ebalik-claims-updated"));
  };

  const confirmDeleteClaim = async () => {
    if (!deleteTarget || deleteConfirmValue !== "CONFIRM" || !isSuperAdmin || deleting) return;
    setDeleting(true);
    try {
      const deleted = await deleteAdminClaim(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteConfirmValue("");
      await refreshClaims();
      window.dispatchEvent(new CustomEvent("ebalik-claims-updated"));
      showInfoModal({
        variant: "success",
        title: "Claim deleted",
        message: "The claim was removed. The deletion was recorded in Claim History.",
        reference: deleted.claim_reference || deleteTarget.claimReference,
        replaceAuto: true,
      });
    } catch {
      // The API helper already reported the failure through the global modal.
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5 p-6" aria-busy="true">
        <div>
          <SkeletonBlock className="mb-2 h-7 w-56" />
          <SkeletonBlock className="h-4 w-32" />
        </div>
        <div className="flex gap-2">
          <SkeletonBlock className="h-10 w-36 rounded-lg" />
          <SkeletonBlock className="h-10 w-36 rounded-lg" />
        </div>
        <AdminTableSkeleton columns={6} rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Claims & Verification</h1>
        <p className="text-sm text-slate-500">{claims.length} total claims</p>
      </div>

      <div className="flex w-fit gap-1 rounded-xl border border-line bg-white p-1.5 shadow-sm">
        {[
          { id: "claims", label: "Claims", count: claims.length },
          { id: "all", label: "Active Claims", count: activeClaims.length },
          { id: "closed", label: "Closed / Completed", count: closedClaims.length },
          { id: "history", label: "Claim History", count: history.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id as "claims" | "all" | "closed" | "history");
              if (tab.id !== "history") clearFilters();
            }}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-all"
            style={activeTab === tab.id ? { background: "#1f3160", color: "white" } : { color: "#6b7280" }}
            aria-pressed={activeTab === tab.id}
          >
            {tab.label} <span className="ml-1 opacity-70">{tab.count}</span>
          </button>
        ))}
      </div>

      {loadError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Unable to load claims: {loadError}</div>}

      {activeTab !== "history" && (
        <div className="grid gap-3 rounded-xl border border-line bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_minmax(170px,1fr)_repeat(2,minmax(145px,0.8fr))_minmax(145px,0.8fr)_auto]">
          <label className="block text-xs font-semibold text-slate-500">
            Claimant name
            <input
              type="search"
              value={claimantFilter}
              onChange={(event) => setFilter(() => setClaimantFilter(event.target.value))}
              placeholder="Search claimant"
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-600/20"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-500">
            Found item ID
            <input
              type="search"
              value={foundItemFilter}
              onChange={(event) => setFilter(() => setFoundItemFilter(event.target.value))}
              placeholder="Found-item ID or reference"
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-600/20"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-500">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setFilter(() => setStatusFilter(event.target.value as typeof statusFilter))}
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-600/20"
            >
              <option value="All">All statuses</option>
              {availableStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-500">
            Submitted from
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setFilter(() => setDateFrom(event.target.value))} className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-600/20" />
          </label>
          <label className="block text-xs font-semibold text-slate-500">
            Submitted to
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setFilter(() => setDateTo(event.target.value))} className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-600/20" />
          </label>
          <label className="block text-xs font-semibold text-slate-500">
            Date order
            <select value={dateOrder} onChange={(event) => setFilter(() => setDateOrder(event.target.value as typeof dateOrder))} className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-600/20">
              <option value="newest">Most recent first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!claimantFilter && !foundItemFilter && statusFilter === "All" && !dateFrom && !dateTo && dateOrder === "newest"}
            className="self-end rounded-lg border border-line px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      )}

      {activeTab !== "history" && dateRangeInvalid && <p role="alert" className="-mt-3 text-sm text-red-600">From date must be on or before the To date.</p>}

      {activeTab === "history" ? (
        <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Recent claim changes</h2>
            <p className="mt-1 text-xs text-slate-500">Newest activity first. This log is not filterable.</p>
          </div>
          {historyError && <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Unable to load claim history: {historyError}. Run the new claim history migration before using this tab.</div>}
          {historyLoading ? (
            <div className="space-y-3 p-5"><SkeletonBlock className="h-16 w-full" /><SkeletonBlock className="h-16 w-full" /><SkeletonBlock className="h-16 w-full" /></div>
          ) : history.length === 0 && !historyError ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No claim changes have been recorded yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {history.map((entry) => (
                <article key={entry.id} className="grid gap-2 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(230px,0.7fr)] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.action === "deleted" ? "bg-red-50 text-red-700" : entry.action === "created" ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {entry.action === "created" ? "Submitted" : entry.action === "deleted" ? "Deleted" : "Updated"}
                      </span>
                      <span className="font-semibold text-slate-900">{entry.claimReference || "Claim reference unavailable"}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{claimHistorySummary(entry)}</p>
                    <p className="mt-1 text-xs text-slate-500">{entry.claimant} · {entry.item} · Found item {entry.foundItemReference || entry.foundItemId || "unavailable"}</p>
                  </div>
                  <div className="text-xs text-slate-500 md:text-right">
                    <div>{new Date(entry.changedAt).toLocaleString()}</div>
                    <div className="mt-1">Changed by {entry.actor}</div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="border-t border-line px-5 py-3 text-sm text-slate-500">{history.length} recorded changes</div>
        </section>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line">
                  {["CLAIM REFERENCE", "CLAIMANT", "FOUND ITEM", "SUBMITTED", "STATUS", "ACTIONS"].map((heading) => (
                    <th key={heading} className="px-5 py-4 text-left text-xs font-semibold tracking-wide text-slate-400">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading && !loadError && visibleClaims.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                      {tabClaims.length === 0
                        ? activeTab === "closed" ? "No claims have been closed or completed yet." : "No active claims need review."
                        : "No claims match these filters."}
                    </td>
                  </tr>
                )}
                {visibleClaims.map((claim) => (
                  <tr key={claim.id} className="border-b border-line transition-colors hover:bg-navy-50">
                    <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-700">{claim.claimReference || claim.id}</td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{claim.claimant}</div>
                      <div className="text-xs text-slate-400">{claim.studentId}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-medium text-slate-800">{claim.item}</div>
                      <div className="text-xs text-slate-500">{claim.itemId}</div>
                      <div className="break-all font-mono text-[12px] text-slate-400">{claim.foundItemId}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{claim.submitted}</td>
                    <td className="px-5 py-4"><StatusBadge status={claim.status} /></td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => setReviewClaim(claim)} className="flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80" style={{ color: "#2563eb" }}>
                          <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" /></svg>
                          Review
                        </button>
                        {activeTab !== "closed" && claim.status === "Approved for Pickup" && (
                          <button
                            type="button"
                            onClick={() => setCollectionTarget(claim)}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1"
                            aria-label={`Record collection and close reports for ${claim.claimReference || claim.id}`}
                          >
                            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Complete &amp; Close
                          </button>
                        )}
                        {isSuperAdmin && (
                          <button
                            onClick={() => { setDeleteTarget(claim); setDeleteConfirmValue(""); }}
                            aria-label={`Delete claim ${claim.claimReference || claim.id}`}
                            title="Delete claim"
                            className="inline-flex size-9 items-center justify-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50"
                          >
                            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-line px-5 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>Showing {filteredClaims.length === 0 ? 0 : (boundedPage - 1) * pageSize + 1}–{Math.min(boundedPage * pageSize, filteredClaims.length)} of {filteredClaims.length} claims</span>
            <nav aria-label={`${activeTab === "closed" ? "Closed claims" : "Active claims"} pages`} className="flex items-center gap-1">
              <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={boundedPage === 1} aria-label="Previous page" className="rounded border border-line px-2.5 py-2 text-xs hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-40">‹</button>
              {pageNumbers.map((page) => (
                <button key={page} type="button" onClick={() => setCurrentPage(page)} aria-current={boundedPage === page ? "page" : undefined} className={`min-w-9 rounded border px-2.5 py-2 text-xs font-semibold ${boundedPage === page ? "border-navy-800 bg-navy-800 text-white" : "border-line text-slate-600 hover:bg-navy-50"}`}>
                  {page}
                </button>
              ))}
              <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={boundedPage === totalPages} aria-label="Next page" className="rounded border border-line px-2.5 py-2 text-xs hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-40">›</button>
            </nav>
          </div>
        </div>
      )}

      {deleteTarget && isSuperAdmin && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/65 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="delete-claim-title" className="w-full max-w-md rounded-[20px] border border-red-100 bg-white p-5 shadow-overlay">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-red-600">Superadmin action</div>
            <h2 id="delete-claim-title" className="text-lg font-bold text-slate-900">Are you sure? Delete this claim?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Double-check the reference. This permanently removes <strong>{deleteTarget.claimReference || deleteTarget.id}</strong> and its uploaded proof/ID files. A deletion event will remain in Claim History.
            </p>
            <label className="mb-1 mt-4 block text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Type CONFIRM to delete</label>
            <input
              value={deleteConfirmValue}
              onChange={(event) => setDeleteConfirmValue(event.target.value)}
              placeholder="CONFIRM"
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setDeleteTarget(null); setDeleteConfirmValue(""); }} disabled={deleting} className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void confirmDeleteClaim()} disabled={deleteConfirmValue !== "CONFIRM" || deleting} className="rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40">{deleting ? "Deleting…" : "Delete claim"}</button>
            </div>
          </section>
        </div>
      )}

      {collectionTarget && (
        <ConfirmActionDialog
          title="record collection and close linked reports?"
          description={`Confirm that ${collectionTarget.claimant} passed in-person ownership verification and received ${collectionTarget.item}. This completes the approved claim, closes its found report, resolves any confirmed matching missing report for this claimant, and closes other claims for the same item.`}
          confirmLabel={collectionBusy ? "Completing..." : "Complete & close reports"}
          busy={collectionBusy}
          onCancel={() => setCollectionTarget(null)}
          onConfirm={() => {
            if (collectionBusy || !collectionTarget) return;
            setCollectionBusy(true);
            void collect(collectionTarget.id)
              .then(() => setCollectionTarget(null))
              .catch(() => {
                // The API helper already reported the failure through the global modal.
              })
              .finally(() => setCollectionBusy(false));
          }}
        />
      )}

      {reviewClaim && (
        <ReviewModal
          claim={reviewClaim}
          onClose={() => setReviewClaim(null)}
          onApprove={approve}
          onReject={reject}
          onCollect={collect}
        />
      )}
    </div>
  );
}
