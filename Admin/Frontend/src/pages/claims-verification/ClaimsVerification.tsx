import { useEffect, useState } from "react";
import type { Claim } from "../../data/mockData";
import { deleteAdminClaim, fetchAdminClaimHistory, fetchAdminClaims, updateAdminClaimStatus, type AdminClaimHistoryRow, type AdminClaimRow } from "../../utils/api";
import { canDelete } from "../../utils/permissions";
import { CheckCircle2, ClipboardCheck, Eye, FilePlus2, ShieldCheck, Trash2, XCircle, ZoomIn } from "lucide-react";
import ClaimFormModal from "./ClaimFormModal";
import { BTN, INPUT, PageHeader, RolePill } from "../../components/ui/primitives";
import AdminModal from "../../components/ui/AdminModal";
import { DataTable, ExportButton, IconAction, RowActions, SegmentedFilter, StatusPill, type Tone } from "../../components/ui/management";
import { useT, tr } from "../../utils/preferences";
import { downloadCsv } from "../../utils/csv";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { showInfoModal } from "../../components/info-modal/infoModalStore";

const CLAIM_TONE: Record<Claim["status"], Tone> = {
  "Under Review": "gold",
  Pending: "gold",
  Verified: "iris",
  Approved: "iris",
  "Approved for Pickup": "iris",
  Collected: "mint",
  Rejected: "rose",
  Unknown: "slate",
};

function StatusBadge({ status }: { status: Claim["status"] }) {
  return <StatusPill tone={CLAIM_TONE[status]}>{status}</StatusPill>;
}

function InfoTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-frost-50 p-4">
      <div className="mb-1 text-[12.5px] font-medium text-ink-muted">{label}</div>
      {children}
    </div>
  );
}

interface ReviewModalProps {
  claim: Claim;
  onClose: () => void;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onCollect: (id: string) => Promise<void>;
  onEditReason?: () => void;
}

function ReviewModal({ claim, onClose, onApprove, onReject, onCollect, onEditReason }: ReviewModalProps) {
  const isPending = claim.status === "Under Review" || claim.status === "Pending";
  const isApprovedForPickup = claim.status === "Approved for Pickup" || claim.status === "Approved";
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [decisionState, setDecisionState] = useState<{ type: "approved" | "rejected" | "error"; message: string } | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | "collect" | null>(null);
  const [confirmValue, setConfirmValue] = useState("");

  const itemDescription = claim.itemDescription || tr("No description provided for this item.");
  const claimReason = claim.claimReason || tr("No additional reason was provided by the claimant.");

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
      setDecisionState({ type: "error", message: tr("Type CONFIRM to approve this claim.") });
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
      setDecisionState({ type: "error", message: tr("Enter a reason so the claimant knows what needs attention.") });
      closeConfirm();
      return;
    }
    if (confirmValue !== "CONFIRM") {
      setDecisionState({ type: "error", message: tr("Type CONFIRM to reject this claim.") });
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
      setDecisionState({ type: "error", message: tr("Type CONFIRM to record collection.") });
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

  const confirmCopy = {
    approve: { title: tr("Approve this claim for pickup?"), body: tr("This approves the claimant for in-person verification at the office and notifies them."), button: tr("Approve claim"), className: BTN.success },
    reject: { title: tr("Reject this claim?"), body: tr("The claimant is notified with the reason you enter below."), button: tr("Reject claim"), className: BTN.danger },
    collect: { title: tr("Record the in-person collection?"), body: tr("Check the claimant's original ID and confirm the item was handed over. This closes the found report and this claim, resolves the claimant's confirmed matching lost report, and closes competing claims for the same item."), button: tr("Record collection"), className: BTN.success },
  } as const;

  return (
    <>
      <AdminModal
        title={tr("Review claim {0}", { "0": claim.claimReference || claim.id })}
        description={tr("{0} is claiming {1}.", { "0": claim.claimant, "1": claim.item })}
        icon={<ClipboardCheck size={20} />}
        size="xl"
        busy={Boolean(confirmAction)}
        onClose={onClose}
        footer={
          isPending ? <>
            <button type="button" onClick={onClose} className={`${BTN.ghost} sm:mr-auto`}>{tr("Close")}</button>
            <button type="button" onClick={() => { setConfirmAction("reject"); setConfirmValue(""); }} className={BTN.ghost}><XCircle size={16} aria-hidden="true" />{tr("Reject claim")}</button>
            <button type="button" onClick={() => { setConfirmAction("approve"); setConfirmValue(""); }} className={BTN.success}><CheckCircle2 size={16} aria-hidden="true" />{tr("Approve for pickup")}</button>
          </> : isApprovedForPickup ? <>
            <button type="button" onClick={onClose} className={`${BTN.ghost} sm:mr-auto`}>{tr("Close")}</button>
            <button type="button" onClick={() => { setConfirmAction("collect"); setConfirmValue(""); }} className={BTN.success}><ShieldCheck size={16} aria-hidden="true" />{tr("Record in-person collection")}</button>
          </> : <button type="button" onClick={onClose} className={BTN.ghost}>{tr("Close")}</button>
        }
      >
        <div className="space-y-5">
          {decisionState && (
            <div role="alert" className={`rounded-xl border px-4 py-3 text-sm font-medium ${decisionState.type === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : decisionState.type === "rejected" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              {decisionState.message}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InfoTile label={tr("Claimant")}>
              <div className="font-semibold text-ink">{claim.claimant}</div>
              <div className="mt-0.5 text-[13px] text-ink-muted">{claim.studentId}</div>
              {claim.claimantEmail && <div className="mt-1.5 break-all text-[13px] text-ink-soft">{claim.claimantEmail}</div>}
            </InfoTile>
            <InfoTile label={tr("Item claimed")}>
              <div className="font-semibold text-ink">{claim.item}</div>
              <div className="mt-0.5 text-[13px] text-ink-muted">{claim.itemId}</div>
            </InfoTile>
            <InfoTile label={tr("Submitted")}><div className="font-semibold text-ink">{claim.submitted}</div></InfoTile>
            <InfoTile label={tr("Status")}><StatusBadge status={claim.status} /></InfoTile>
          </div>

          <p className="rounded-2xl border border-gold-200 bg-gold-50 px-4 py-3 text-[14px] leading-6 text-ink-soft dark:border-gold-500/25">
            {tr("Before approving, match the campus ID, compare the proof with the item photo, and confirm details only the owner would know.")}
          </p>

          <div className="grid gap-3 md:grid-cols-3">
            <InfoTile label={tr("Found item details")}>
              <p className="text-[14px] text-ink-soft">{[claim.itemCategory, claim.itemLocation, claim.itemFoundDate].filter(Boolean).join(", ") || tr("Details unavailable")}</p>
            </InfoTile>
            <InfoTile label={tr("Item description")}><p className="text-[14px] leading-6 text-ink-soft">{itemDescription}</p></InfoTile>
            <InfoTile label={tr("Claim reason")}>
              <p className="text-[14px] leading-6 text-ink-soft">{claimReason}</p>
              {onEditReason && (isPending || isApprovedForPickup) && (
                <button type="button" onClick={onEditReason} className="mt-2 rounded-lg px-2 py-1 text-[13px] font-semibold text-iris-700 hover:bg-iris-50">{tr("Edit reason")}</button>
              )}
            </InfoTile>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {([["Claim proof", claim.proofImage, tr("No proof image")], ["Found item photo", claim.foundImage, tr("No item photo")]] as const).map(([label, src, empty]) => (
              <figure key={label} className="rounded-2xl border border-line bg-frost-50 p-3">
                <figcaption className="mb-2 text-[12.5px] font-medium text-ink-muted">{label}</figcaption>
                {src ? (
                  <button type="button" onClick={() => setZoomedImage(src)} className="group relative block w-full overflow-hidden rounded-xl" aria-label={tr("Enlarge {0}", { "0": label.toLowerCase() })}>
                    <img decoding="async" src={src} alt={label} className="h-56 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    <span className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-lg bg-navy-950/60 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"><ZoomIn size={16} aria-hidden="true" /></span>
                  </button>
                ) : (
                  <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-line-strong text-[13px] text-ink-muted">{empty}</div>
                )}
              </figure>
            ))}
            <figure className="rounded-2xl border border-line bg-frost-50 p-3">
              <figcaption className="mb-2 text-[12.5px] font-medium text-ink-muted">{tr("Claimant ID ({0})", { "0": claim.identityDocumentType === "verified_in_person" ? tr("checked in person") : claim.identityDocumentType || tr("identity document") })}</figcaption>
              {claim.identityDocument ? (
                <a href={claim.identityDocument} target="_blank" rel="noreferrer" className="flex h-56 flex-col items-center justify-center gap-1.5 rounded-xl border border-iris-200 bg-iris-50 text-[14px] font-semibold text-iris-700 transition hover:brightness-105 dark:border-iris-500/30">
                  <ShieldCheck size={22} aria-hidden="true" />
                  {tr("Open private ID document")}
                  <span className="text-[12.5px] font-normal text-ink-muted">{tr("Temporary secure link")}</span>
                </a>
              ) : (
                <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-line-strong px-4 text-center text-[13px] text-ink-muted">{claim.identityDocumentType === "verified_in_person" ? tr("ID was checked at the office") : tr("No ID document")}</div>
              )}
            </figure>
          </div>
        </div>
      </AdminModal>

      {confirmAction && (
        <AdminModal
          title={confirmCopy[confirmAction].title}
          description={confirmCopy[confirmAction].body}
          icon={confirmAction === "reject" ? <XCircle size={20} /> : <CheckCircle2 size={20} />}
          tone={confirmAction === "reject" ? "danger" : "mint"}
          size="sm"
          onClose={closeConfirm}
          footer={<>
            <button type="button" onClick={closeConfirm} className={BTN.ghost}>{tr("Cancel")}</button>
            <button
              type="button"
              onClick={confirmAction === "approve" ? handleApprove : confirmAction === "reject" ? handleReject : handleCollect}
              disabled={confirmValue !== "CONFIRM" || (confirmAction === "reject" && !rejectionReason.trim())}
              className={confirmCopy[confirmAction].className}
            >
              {confirmCopy[confirmAction].button}
            </button>
          </>}
        >
          <div className="space-y-4">
            {confirmAction === "reject" && (
              <label className="block">
                <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Reason the claimant will see")}</span>
                <textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder={tr("The proof photo doesn't show the engraving described.")} rows={3} className={`${INPUT} resize-y py-3 leading-6`} data-autofocus />
              </label>
            )}
            <label className="block">
              <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Type CONFIRM to continue")}</span>
              <input value={confirmValue} onChange={(event) => setConfirmValue(event.target.value)} placeholder={tr("CONFIRM")} autoComplete="off" className={`${INPUT} text-center font-semibold tracking-[0.2em]`} data-autofocus={confirmAction !== "reject" ? true : undefined} />
            </label>
          </div>
        </AdminModal>
      )}

      {zoomedImage && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm" onClick={() => setZoomedImage(null)} role="dialog" aria-modal="true" aria-label={tr("Enlarged image")}>
          <div className="relative max-h-[90vh] w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setZoomedImage(null)} aria-label={tr("Close image")} className="absolute -right-3 -top-3 z-10 flex size-10 items-center justify-center rounded-full bg-white text-xl text-navy-950 shadow-lg">×</button>
            <img decoding="async" src={zoomedImage} alt={tr("Enlarged claim evidence")} className="max-h-[90vh] w-full rounded-2xl object-contain" />
          </div>
        </div>
      )}
    </>
  );
}

function claimHistorySummary(entry: AdminClaimHistoryRow): string {
  if (entry.action === "created") return tr("Claim submitted");
  if (entry.action === "deleted") return tr("Claim deleted by Superadmin");

  const labels: Record<string, string> = {
    status: "Status",
    rejection_reason: tr("Rejection reason"),
    reviewed_at: tr("Review date"),
    collected_at: tr("Collection date"),
    pickup_deadline: tr("Pickup deadline"),
  };
  const fields = Object.entries(labels).flatMap(([key, label]) => {
    const oldValue = entry.oldValues?.[key];
    const newValue = entry.newValues?.[key];
    if (oldValue === newValue || (oldValue == null && newValue == null)) return [];
    if (key === "status") {
      return [`${label}: ${String(oldValue ?? tr("None")).replace(/_/g, " ")} → ${String(newValue ?? tr("None")).replace(/_/g, " ")}`];
    }
    if (key === "rejection_reason") return [`${label}: ${String(newValue || tr("Removed"))}`];
    return [`${label} updated`];
  });

  return fields.join(" · ") || tr("Claim details updated");
}

export default function ClaimsVerification() {
  const t = useT();
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
  const [claimForm, setClaimForm] = useState<{ mode: "create" } | { mode: "edit"; claim: Claim } | null>(null);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [collectionTarget, setCollectionTarget] = useState<Claim | null>(null);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const isSuperAdmin = canDelete();
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
      const message = error instanceof Error ? error.message : tr("Unable to load claims.");
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
        setLoadError(error instanceof Error ? error.message : tr("Unable to load claims."));
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
        setHistoryError(error instanceof Error ? error.message : tr("Unable to load claim history."));
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

  const exportCsv = () => downloadCsv("claims", ["Claim", "Claimant", "Campus ID", "Item", "Found item", "Submitted", "Status"],
    filteredClaims.map((claim) => [claim.claimReference || claim.id, claim.claimant, claim.studentId, claim.item, claim.itemId, claim.submitted, claim.status]));

  if (loading) {
    return (
      <div className="space-y-5 p-4 sm:p-6" aria-busy="true">
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
    <div className="space-y-5 p-4 sm:p-6">

      <PageHeader
        title={t("claims.title")}
        description={t("claims.description", { count: claims.length })}
        meta={<RolePill superAdmin={isSuperAdmin} />}
        actions={<>
          {activeTab !== "history" && <ExportButton onClick={exportCsv} disabled={!filteredClaims.length} />}
          <button type="button" onClick={() => setClaimForm({ mode: "create" })} className={BTN.primary}><FilePlus2 size={17} aria-hidden="true" />{t("claims.add")}</button>
        </>}
      />

      <SegmentedFilter
        label={tr("Claim views")}
        value={activeTab}
        onChange={(tab) => {
          setActiveTab(tab);
          if (tab !== "history") clearFilters();
        }}
        options={[
          { value: "claims", label: "All claims", count: claims.length },
          { value: "all", label: "Active", count: activeClaims.length },
          { value: "closed", label: "Closed and completed", count: closedClaims.length },
          { value: "history", label: "Change history", count: history.length },
        ]}
      />

      {loadError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{tr("Unable to load claims: {0}", { "0": loadError })}</div>}

      {activeTab !== "history" && (
        <div className="glass-panel grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_minmax(170px,1fr)_repeat(2,minmax(145px,0.8fr))_minmax(145px,0.8fr)_auto]">
          <label className="block text-[13px] font-semibold text-ink-soft">
            {tr("Claimant name")}
            <input
              type="search"
              value={claimantFilter}
              onChange={(event) => setFilter(() => setClaimantFilter(event.target.value))}
              placeholder={tr("Search claimant")}
              className={`mt-1.5 font-normal ${INPUT}`}
            />
          </label>
          <label className="block text-[13px] font-semibold text-ink-soft">
            {tr("Found item ID")}
            <input
              type="search"
              value={foundItemFilter}
              onChange={(event) => setFilter(() => setFoundItemFilter(event.target.value))}
              placeholder={tr("Found-item ID or reference")}
              className={`mt-1.5 font-normal ${INPUT}`}
            />
          </label>
          <label className="block text-[13px] font-semibold text-ink-soft">
            {tr("Status")}
            <select
              value={statusFilter}
              onChange={(event) => setFilter(() => setStatusFilter(event.target.value as typeof statusFilter))}
              className={`mt-1.5 font-normal ${INPUT}`}
            >
              <option value="All">{tr("All statuses")}</option>
              {availableStatuses.map((status) => <option key={status} value={status}>{tr(status)}</option>)}
            </select>
          </label>
          <label className="block text-[13px] font-semibold text-ink-soft">
            {tr("Submitted from")}
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setFilter(() => setDateFrom(event.target.value))} className={`mt-1.5 font-normal ${INPUT}`} />
          </label>
          <label className="block text-[13px] font-semibold text-ink-soft">
            {tr("Submitted to")}
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setFilter(() => setDateTo(event.target.value))} className={`mt-1.5 font-normal ${INPUT}`} />
          </label>
          <label className="block text-[13px] font-semibold text-ink-soft">
            {tr("Date order")}
            <select value={dateOrder} onChange={(event) => setFilter(() => setDateOrder(event.target.value as typeof dateOrder))} className={`mt-1.5 font-normal ${INPUT}`}>
              <option value="newest">{tr("Most recent first")}</option>
              <option value="oldest">{tr("Oldest first")}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!claimantFilter && !foundItemFilter && statusFilter === "All" && !dateFrom && !dateTo && dateOrder === "newest"}
            className={`self-end ${BTN.ghost}`}
          >
            {t("common.clearFilters")}
          </button>
        </div>
      )}

      {activeTab !== "history" && dateRangeInvalid && <p role="alert" className="-mt-3 text-sm text-red-600">{tr("From date must be on or before the To date.")}</p>}

      {activeTab === "history" ? (
        <section className="glass-panel overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-[family-name:var(--font-heading)] text-[17px] font-semibold text-ink">{tr("Recent claim changes")}</h2>
            <p className="mt-1 text-[13px] text-ink-muted">{tr("Newest first.")}</p>
          </div>
          {historyError && <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{tr("Unable to load claim history: {0}. Run the claim history migration before using this tab.", { "0": historyError })}</div>}
          {historyLoading ? (
            <div className="space-y-3 p-5"><SkeletonBlock className="h-16 w-full" /><SkeletonBlock className="h-16 w-full" /><SkeletonBlock className="h-16 w-full" /></div>
          ) : history.length === 0 && !historyError ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">{tr("No claim changes have been recorded yet.")}</p>
          ) : (
            <div className="divide-y divide-line">
              {history.map((entry) => (
                <article key={entry.id} className="grid gap-2 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(230px,0.7fr)] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.action === "deleted" ? "bg-red-50 text-red-700" : entry.action === "created" ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {entry.action === "created" ? tr("Submitted") : entry.action === "deleted" ? tr("Deleted") : tr("Updated")}
                      </span>
                      <span className="font-semibold text-slate-900">{entry.claimReference || tr("Claim reference unavailable")}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{claimHistorySummary(entry)}</p>
                    <p className="mt-1 text-xs text-slate-500">{entry.claimant}, {entry.item}, found item {entry.foundItemReference || entry.foundItemId || "unavailable"}</p>
                  </div>
                  <div className="text-xs text-slate-500 md:text-right">
                    <div>{new Date(entry.changedAt).toLocaleString()}</div>
                    <div className="mt-1">{tr("Changed by {0}", { "0": entry.actor })}</div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="border-t border-line px-5 py-3 text-sm text-slate-500">{tr("{0} recorded changes", { "0": history.length })}</div>
        </section>
      ) : (
        <DataTable
          caption={t("claims.title")}
          minWidth={980}
          columns={[
            { key: "ref", label: t("claims.col.reference") },
            { key: "claimant", label: t("claims.col.claimant") },
            { key: "item", label: t("claims.col.item") },
            { key: "submitted", label: t("claims.col.submitted") },
            { key: "status", label: t("common.status") },
            { key: "actions", label: t("common.actions") },
          ]}
          isEmpty={!loadError && visibleClaims.length === 0}
          empty={tabClaims.length === 0
            ? activeTab === "closed" ? tr("No claims have been closed or completed yet.") : tr("No active claims need review.")
            : t("common.noMatches")}
          footer={
            <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-[13px] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <span className="tabular-nums">{t("common.showing", { from: filteredClaims.length === 0 ? 0 : (boundedPage - 1) * pageSize + 1, to: Math.min(boundedPage * pageSize, filteredClaims.length), total: filteredClaims.length })}</span>
              {totalPages > 1 && (
                <nav aria-label={tr("Claim pages")} className="flex items-center gap-1">
                  <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={boundedPage === 1} aria-label={t("common.previous")} className="icon-action">‹</button>
                  {pageNumbers.map((page) => (
                    <button key={page} type="button" onClick={() => setCurrentPage(page)} aria-current={boundedPage === page ? "page" : undefined} className={`min-h-9 min-w-9 rounded-xl px-2.5 text-[13px] font-semibold tabular-nums transition-colors ${boundedPage === page ? "bg-navy-800 text-white dark:bg-[linear-gradient(180deg,#ecc787,#d1a153)] dark:text-navy-950" : "text-ink-soft hover:bg-navy-50"}`}>
                      {page}
                    </button>
                  ))}
                  <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={boundedPage === totalPages} aria-label={t("common.next")} className="icon-action">›</button>
                </nav>
              )}
            </div>
          }
        >
          {visibleClaims.map((claim) => (
            <tr key={claim.id} data-tone={CLAIM_TONE[claim.status]}>
              <td className="whitespace-nowrap font-semibold text-ink">{claim.claimReference || claim.id}</td>
              <td>
                <div className="max-w-[220px] truncate font-semibold text-ink">{claim.claimant}</div>
                <div className="text-[13px] text-ink-muted">{claim.studentId}</div>
              </td>
              <td>
                <div className="max-w-[260px] truncate font-medium text-ink">{claim.item}</div>
                <div className="text-[13px] text-ink-muted">{claim.itemId}</div>
              </td>
              <td className="whitespace-nowrap">{claim.submitted}</td>
              <td><StatusBadge status={claim.status} /></td>
              <RowActions>
                <IconAction label={`${t("claims.review")} ${claim.claimReference || claim.id}`} onClick={() => setReviewClaim(claim)} icon={<Eye size={17} aria-hidden="true" />} />
                {activeTab !== "closed" && claim.status === "Approved for Pickup" && (
                  <IconAction label={`${t("claims.complete")} ${claim.claimReference || claim.id}`} tone="success" onClick={() => setCollectionTarget(claim)} icon={<ShieldCheck size={17} aria-hidden="true" />} />
                )}
                {isSuperAdmin && (
                  <IconAction label={`${t("common.delete")} ${claim.claimReference || claim.id}`} tone="danger" onClick={() => { setDeleteTarget(claim); setDeleteConfirmValue(""); }} icon={<Trash2 size={16} aria-hidden="true" />} />
                )}
              </RowActions>
            </tr>
          ))}
        </DataTable>
      )}

      {deleteTarget && isSuperAdmin && (
        <AdminModal
          title={tr("Delete claim {0}?", { "0": deleteTarget.claimReference || deleteTarget.id })}
          description={tr("This permanently removes the claim and its uploaded proof and ID files. A deletion entry stays in the change history.")}
          icon={<Trash2 size={19} />}
          tone="danger"
          size="sm"
          busy={deleting}
          onClose={() => { setDeleteTarget(null); setDeleteConfirmValue(""); }}
          footer={<>
            <button type="button" onClick={() => { setDeleteTarget(null); setDeleteConfirmValue(""); }} disabled={deleting} className={BTN.ghost}>{tr("Cancel")}</button>
            <button type="button" onClick={() => void confirmDeleteClaim()} disabled={deleteConfirmValue !== "CONFIRM" || deleting} className={BTN.danger}>{deleting ? tr("Deleting…") : tr("Delete claim")}</button>
          </>}
        >
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Type CONFIRM to delete")}</span>
            <input value={deleteConfirmValue} onChange={(event) => setDeleteConfirmValue(event.target.value)} placeholder={tr("CONFIRM")} autoComplete="off" data-autofocus className={`${INPUT} text-center font-semibold tracking-[0.2em]`} />
          </label>
        </AdminModal>
      )}

      {collectionTarget && (
        <ConfirmActionDialog
          title={tr("record collection and close linked reports?")}
          description={tr("Confirm that {0} passed in-person ownership verification and received {1}. This completes the approved claim, closes its found report, resolves any confirmed matching missing report for this claimant, and closes other claims for the same item.", { "0": collectionTarget.claimant, "1": collectionTarget.item })}
          confirmLabel={collectionBusy ? tr("Completing...") : tr("Complete & close reports")}
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
          onEditReason={() => setClaimForm({ mode: "edit", claim: reviewClaim })}
        />
      )}

      {claimForm && (claimForm.mode === "create" ? (
        <ClaimFormModal mode="create" onClose={() => setClaimForm(null)} onSaved={() => { void refreshClaims().catch(() => undefined); window.dispatchEvent(new CustomEvent("ebalik-claims-updated")); }} />
      ) : (
        <ClaimFormModal
          mode="edit"
          claimId={claimForm.claim.id}
          claimReference={claimForm.claim.claimReference}
          currentReason={claimForm.claim.claimReason}
          onClose={() => setClaimForm(null)}
          onSaved={() => { setReviewClaim(null); void refreshClaims().catch(() => undefined); }}
        />
      ))}
    </div>
  );
}
