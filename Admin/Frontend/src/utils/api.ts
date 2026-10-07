import { showInfoModal, type InfoModalVariant } from "../components/info-modal/infoModalStore";
import { tr } from "./preferences";
import { markActive } from "./sessionGuard";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * Reports a finished admin process through the global information modal.
 * Mutation helpers call this automatically; pages may follow up with a more specific
 * `showInfoModal({ ..., replaceAuto: true })`, which replaces this generic message.
 */
export function reportAdminProcess(result: { success: boolean; title: string; message: string; variant?: InfoModalVariant }) {
  showInfoModal({
    variant: result.variant ?? (result.success ? "success" : "error"),
    title: result.title,
    message: result.message,
    auto: true,
  });
}

export async function adminMutationRequest(url: string, options: RequestInit, title: string): Promise<Response> {
  try {
    const response = await fetch(url, options);
    const payload = await response.clone().json().catch(() => ({}));
    reportAdminProcess({
      success: response.ok,
      title,
      message: response.ok
        ? (typeof payload.message === "string" ? payload.message : tr("{0} completed successfully.", { "0": tr(title) }))
        : (typeof payload.error === "string" ? payload.error : tr("{0} could not be completed.", { "0": tr(title) })),
    });
    return response;
  } catch (error) {
    reportAdminProcess({
      success: false,
      title,
      message: error instanceof Error ? error.message : tr("{0} could not be completed. Check your connection and try again.", { "0": tr(title) }),
    });
    throw error;
  }
}

export interface AdminUser {
  account_id: string;
  email: string;
  fname: string;
  mname?: string;
  lname: string;
  campus_id?: string;
  user_role: string;
  access_level: "guard" | "admin" | "super_admin";
}

export interface AdminDashboardSummary {
  total_users: number;
  total_lost_reports: number;
  found_items: number;
  potential_ai_matches: number;
  pending_claims: number;
  successfully_returned: number;
  unresolved_items: number;
  chart_data: Array<{ month: string; lost: number; found: number }>;
  average_resolution_days?: number | null;
  ai_confirmed?: number;
  ai_decided?: number;
  claim_approval_rate?: number;
  reviewed_claims?: number;
  collected_claims?: number;
  current_month_processed?: number;
  recovery_rate?: number;
  claim_status_counts?: Record<string, number>;
  recent_activity?: Array<{
    id: string;
    timestamp: string;
    user: string;
    userId: string;
    action: string;
    module: string;
    target: string;
    targetId: string;
    result: "Success" | "Warning" | "Error";
  }>;
}

export interface AdminReportsData {
  summary: AdminDashboardSummary;
  categories: Array<{ name: string; value: number }>;
  locations: Array<{ location: string; lost: number; found: number }>;
}

export interface AdminUserRow {
  id: string;
  name: string;
  initials: string;
  studentId: string;
  email: string;
  program: string;
  reports: number;
  claims: number;
  status: "Active" | "Suspended" | "Inactive";
  accessLevel: "user" | "guard" | "admin" | "super_admin";
  lastActivity: string;
  verification?: "pending" | "verified" | "rejected";
  category?: string | null;
  suspendedUntil?: string | null;
}

export interface AdminAccountVerificationRequest {
  account_id: string;
  name: string;
  email: string;
  campus_id: string;
  user_role: string;
  access_level: string;
  verification_status: "pending";
  document_type: string;
  document_name: string;
  uploaded_at: string;
  review_note: string;
  document_url: string | null;
}

export interface AdminClaimRow {
  id: string;
  claimReference: string;
  foundItemId: string;
  claimant: string;
  studentId: string;
  claimantEmail?: string;
  item: string;
  itemId: string;
  itemCategory?: string;
  itemLocation?: string;
  itemFoundDate?: string;
  itemDescription?: string;
  claimReason?: string;
  proofImage?: string;
  identityDocument?: string;
  identityDocumentType?: string;
  rejectionReason?: string;
  foundImage?: string;
  submitted: string;
  submittedAt?: string;
  status: "Under Review" | "Pending" | "Verified" | "Rejected" | "Approved" | "Approved for Pickup" | "Collected" | "Unknown";
}

export interface AdminClaimHistoryRow {
  id: string;
  claimId: string;
  claimReference: string;
  foundItemId: string;
  foundItemReference: string;
  claimant: string;
  item: string;
  actor: string;
  action: "created" | "updated" | "deleted";
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedAt: string;
}

export interface AdminFoundItemRow {
  id: string;
  item: string;
  description: string;
  category: string;
  locationFound: string;
  dateFound: string;
  guardName?: string;
  createdAt?: string;
  storage: string;
  aiStatus: string;
  aiPercent: number | null;
  matchedItem?: string;
  status: "Ready to Release" | "Under Review" | "Released" | "Claimed" | "Unclaimed" | "Auctioned";
  /** Stored found_items.status (unclaimed, review, claimed, ready_to_release, returned...). */
  rawStatus?: string;
  photo?: string;
}

export interface AdminLostItemRow {
  id: string;
  item: string;
  description: string;
  category: string;
  location: string;
  dateLost: string;
  reportedBy: string;
  studentId: string;
  photo?: string;
  aiMatch: number | null;
  status: "Searching" | "Potential Match" | "Found" | "Resolved" | "Expired";
  /** Stored missing_items.status: missing | found | returned. */
  rawStatus?: string;
}

export interface UserActivityLog {
  id: string;
  timestamp: string;
  user: string;
  userId: string;
  action: string;
  module: string;
  target: string;
  targetId: string;
  result: "Success" | "Warning" | "Error";
}

export interface AdminAIMatchRow {
  id: string;
  status: "High Confidence" | "Needs Review" | "Confirmed" | "Rejected";
  timestamp?: string;
  lostId: string;
  lostItem: string;
  lostDesc: string;
  lostLocation: string;
  lostDate: string;
  lostImage?: string;
  foundId: string;
  foundItem: string;
  foundDesc: string;
  foundLocation: string;
  foundDate: string;
  foundImage?: string;
  matchPercent: number;
  visualSim: number;
  descSim: number;
  locationSim: number;
  timeSim: number;
}

interface LoginResponse {
  token?: string;
  user_role?: string;
  [key: string]: unknown;
}

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("ebalik_admin_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function adminLogin(email: string, password: string): Promise<AdminUser> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, admin_only: true }),
  });
  const data = (await response.json()) as LoginResponse;

  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Unable to sign in");
  }
  const accessLevel = String(data.access_level || "").toLowerCase();
  if (!data.token || !["admin", "super_admin", "guard"].includes(accessLevel || String(data.user_role || "").toLowerCase())) {
    throw new Error("Staff access is required");
  }

  localStorage.setItem("ebalik_admin_token", data.token);
  markActive();  // a new sign-in starts its idle clock now
  const user = {
    account_id: String(data.account_id),
    email: String(data.email),
    fname: String(data.fname || ""),
    mname: data.mname ? String(data.mname) : "",
    lname: String(data.lname || ""),
    campus_id: data.campus_id ? String(data.campus_id) : "",
    user_role: String(data.user_role),
    access_level: (accessLevel || "admin") as AdminUser["access_level"],
  };
  localStorage.setItem("ebalik_admin_user", JSON.stringify(user));
  return user;
}

export async function fetchAdminDashboard(): Promise<AdminDashboardSummary> {
  const response = await fetch(`${API_URL}/api/admin/dashboard`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to load dashboard data");
  }

  return (await response.json()) as AdminDashboardSummary;
}

export async function fetchAdminReports(): Promise<AdminReportsData> {
  const response = await fetch(`${API_URL}/api/admin/reports`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load analytics reports");
  return payload as AdminReportsData;
}

export async function fetchAdminUsers(): Promise<AdminUserRow[]> {
  const response = await fetch(`${API_URL}/api/admin/users`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to load users");
  }

  const data = (await response.json()) as { users?: AdminUserRow[] };
  return (data.users ?? []).map((user) => ({
    ...user,
    accessLevel: user.accessLevel || "user",
  }));
}

export async function fetchAdminAccountVerifications(): Promise<AdminAccountVerificationRequest[]> {
  const response = await fetch(`${API_URL}/api/admin/account-verifications`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load account verification requests");
  return (payload.requests ?? []) as AdminAccountVerificationRequest[];
}

export async function reviewAdminAccountVerification(
  accountId: string,
  status: "verified" | "rejected",
  userCategory: string,
  reviewNote: string,
) {
  const response = await adminMutationRequest(`${API_URL}/api/admin/account-verifications/${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ status, user_category: userCategory, review_note: reviewNote }),
  }, status === "verified" ? "Verify account identity" : "Reject account verification");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to review account verification");
  return payload as { success: boolean; user: { account_id: string; verification_status: "verified" | "rejected"; user_role: string } };
}

export async function updateAdminUserStatus(accountId: string, status: "active" | "suspended", options: { days?: number | null; reason?: string } = {}) {
  const response = await adminMutationRequest(`${API_URL}/api/admin/users/${accountId}/status`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ status, ...(options.days ? { days: options.days } : {}), ...(options.reason ? { reason: options.reason } : {}) }),
  }, status === "active" ? "Reactivate account" : "Suspend account");

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to update user status");
  }

  return response.json();
}

export async function updateAdminUserAccessLevel(accountId: string, accessLevel: "user" | "guard" | "admin") {
  const response = await adminMutationRequest(`${API_URL}/api/admin/users/${accountId}/access-level`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ access_level: accessLevel }),
  }, accessLevel === "admin" ? "Promote user to admin" : accessLevel === "guard" ? "Make user a guard" : "Remove staff access");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to update user access level");
  }
  return payload as { user: { account_id: string; email: string; access_level: "user" | "guard" | "admin" } };
}

export async function deleteAdminUser(accountId: string, authenticatorCode: string) {
  const response = await adminMutationRequest(`${API_URL}/api/admin/users/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify({ confirmation: "CONFIRM", authenticator_code: authenticatorCode }),
  }, "Delete user account");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.error === "string" ? payload.error : "Unable to delete user account";
    throw new Error(detail);
  }
  return payload as {
    success: boolean;
    message: string;
    deleted_found_items: number;
    deleted_missing_items: number;
    deleted_claims: number;
    storage_cleanup_complete: boolean;
    storage_cleanup_failures: string[];
  };
}

export async function fetchAdminMfaStatus(): Promise<{ enabled: boolean }> {
  const response = await fetch(`${API_URL}/api/admin/mfa/status`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load authenticator status");
  return payload as { enabled: boolean };
}

export async function beginAdminMfaSetup(password: string): Promise<{ qr_data_url: string; manual_setup_key: string; expires_at: string }> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/mfa/setup`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ password }),
  }, "Start authenticator setup");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to start authenticator setup");
  return payload as { qr_data_url: string; manual_setup_key: string; expires_at: string };
}

export async function verifyAdminMfaSetup(code: string): Promise<{ enabled: boolean; recovery_codes: string[]; token: string }> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/mfa/verify-setup`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ code }),
  }, "Enable authenticator MFA");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to verify authenticator setup");
  const result = payload as { enabled: boolean; recovery_codes: string[]; token: string };
  if (result.token) { localStorage.setItem("ebalik_admin_token", result.token); markActive(); }
  return result;
}

export async function disableAdminMfa(password: string, code: string): Promise<void> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/mfa/disable`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ password, code }),
  }, "Disable authenticator MFA");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to disable authenticator MFA");
  if (typeof payload.token === "string") { localStorage.setItem("ebalik_admin_token", payload.token); markActive(); }
}

export async function fetchAdminClaims(): Promise<AdminClaimRow[]> {
  const response = await fetch(`${API_URL}/api/admin/claims`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to load claims");
  }

  const data = (await response.json()) as { claims?: AdminClaimRow[] };
  return data.claims ?? [];
}

export async function fetchAdminClaimHistory(): Promise<AdminClaimHistoryRow[]> {
  const response = await fetch(`${API_URL}/api/admin/claims/history`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to load claim history");
  }

  const data = (await response.json()) as { history?: AdminClaimHistoryRow[] };
  return data.history ?? [];
}

export async function fetchAdminLostItems(): Promise<AdminLostItemRow[]> {
  const response = await fetch(`${API_URL}/api/admin/lost-items`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to load lost items");
  }

  const data = (await response.json()) as { items?: AdminLostItemRow[] };
  return data.items ?? [];
}

export type CustodyState = "waiting" | "claim_review" | "claim_approved" | "hold" | "auction" | "auction_review" | "sold_pickup";

export interface AdminCustodyRow {
  reference: string;
  item: string;
  category: string;
  storage: string;
  guard: string;
  photo: string;
  daysHeld: number;
  state: CustodyState;
  stateLabel: string;
  openClaims: number;
  auctionEligible: boolean;
}

export interface AdminCustodyOverview {
  items: AdminCustodyRow[];
  summary: { total: number; needsReview: number; awaitingPickup: number; inAuction: number; waiting: number; onHold: number; auctionEligible: number; minCustodyDays: number };
}

/** Every found item the office still holds, with what is happening to each one. */
export async function fetchAdminCustody(): Promise<AdminCustodyOverview> {
  const response = await fetch(`${API_URL}/api/admin/found-items/custody`, { headers: getAuthHeaders() });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to load the items in custody");
  }
  return (await response.json()) as AdminCustodyOverview;
}

export async function fetchAdminFoundItems(): Promise<AdminFoundItemRow[]> {
  const response = await fetch(`${API_URL}/api/admin/found-items`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to load found items");
  }

  const data = (await response.json()) as { items?: AdminFoundItemRow[] };
  return data.items ?? [];
}

async function adminItemMutation(path: string, method: "POST" | "PUT" | "DELETE", body?: Record<string, unknown>) {
  const action = method === "DELETE" ? "Delete" : method === "POST" ? "Create" : "Update";
  const kind = path.startsWith("lost-items") ? "lost item" : "found item";
  const response = await adminMutationRequest(`${API_URL}/api/admin/${path}`, {
    method,
    headers: getAuthHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, `${action} ${kind}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Unable to save item changes");
  }
  return payload as { success: boolean; reference?: string };
}

export function createAdminLostItem(item: Record<string, unknown>) {
  return adminItemMutation("lost-items", "POST", item);
}

export function updateAdminLostItem(reference: string, item: Record<string, unknown>) {
  return adminItemMutation(`lost-items/${encodeURIComponent(reference)}`, "PUT", item);
}

export function deleteAdminLostItem(reference: string) {
  return adminItemMutation(`lost-items/${encodeURIComponent(reference)}`, "DELETE");
}

export function createAdminFoundItem(item: Record<string, unknown>) {
  return adminItemMutation("found-items", "POST", item);
}

export function updateAdminFoundItem(reference: string, item: Record<string, unknown>) {
  return adminItemMutation(`found-items/${encodeURIComponent(reference)}`, "PUT", item);
}

export function deleteAdminFoundItem(reference: string) {
  return adminItemMutation(`found-items/${encodeURIComponent(reference)}`, "DELETE");
}

export async function fetchAdminActivityLogs(): Promise<UserActivityLog[]> {
  const response = await fetch(`${API_URL}/api/admin/activity-logs`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to load activity logs");
  }

  const data = (await response.json()) as { logs?: UserActivityLog[] };
  return data.logs ?? [];
}

export async function fetchAdminAdministratorActivityLogs(): Promise<UserActivityLog[]> {
  const response = await fetch(`${API_URL}/api/admin/admin-activity-logs`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to load administrator activity logs");
  }
  const data = (await response.json()) as { logs?: UserActivityLog[] };
  return data.logs ?? [];
}

export async function fetchAdminAIMatches(): Promise<AdminAIMatchRow[]> {
  const response = await fetch(`${API_URL}/api/admin/ai-matches`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : "Unable to load AI matches");
  }

  const data = (await response.json()) as { matches?: AdminAIMatchRow[] };
  return data.matches ?? [];
}

export async function confirmAdminAIMatch(missingItemId: string, foundItemId: string): Promise<{ success: boolean; notification_id?: string; message?: string }> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/ai-matches/${missingItemId}/${foundItemId}/confirm`, {
    method: "POST",
    headers: getAuthHeaders(),
  }, "Confirm AI match");

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = typeof error.error === "string" ? error.error : "Unable to confirm AI match";
    const detail = typeof error.details === "string" ? ` Details: ${error.details}` : "";
    throw new Error(`${message}${detail}`);
  }

  const data = (await response.json()) as { success: boolean; notification_id?: string; message?: string };
  return data;
}

export async function rejectAdminAIMatch(missingItemId: string, foundItemId: string): Promise<{ success: boolean; message?: string }> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/ai-matches/${missingItemId}/${foundItemId}/reject`, {
    method: "POST",
    headers: getAuthHeaders(),
  }, "Reject AI match");

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = typeof error.error === "string" ? error.error : "Unable to reject AI match";
    const detail = typeof error.details === "string" ? ` Details: ${error.details}` : "";
    throw new Error(`${message}${detail}`);
  }

  const data = (await response.json()) as { success: boolean; message?: string };
  return data;
}

export async function updateAdminClaimStatus(claimId: string, status: "approved_for_pickup" | "rejected" | "collected", rejectionReason?: string) {
  const response = await adminMutationRequest(`${API_URL}/api/admin/claims/${claimId}/status`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ status, rejection_reason: rejectionReason }),
  }, status === "approved_for_pickup" ? "Approve claim" : status === "rejected" ? "Reject claim" : "Record collection");

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : "Unable to update claim status";
    const detail = typeof payload.details === "string" ? ` Details: ${payload.details}` : "";
    throw new Error(`${message}${detail}`);
  }

  return payload;
}

export async function deleteAdminClaim(claimId: string): Promise<{ success: boolean; claim_reference?: string; message?: string }> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/claims/${encodeURIComponent(claimId)}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  }, "Delete claim");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : "Unable to delete claim";
    const detail = typeof payload.details === "string" ? ` Details: ${payload.details}` : "";
    throw new Error(`${message}${detail}`);
  }
  return payload as { success: boolean; claim_reference?: string; message?: string };
}

export function getStoredAdmin(): AdminUser | null {
  const token = localStorage.getItem("ebalik_admin_token");
  const rawUser = localStorage.getItem("ebalik_admin_user");
  if (!token || !rawUser) return null;

  try {
    const user = JSON.parse(rawUser) as AdminUser;
    const accessLevel = String(user.access_level || user.user_role || "").toLowerCase();
    if (!["admin", "super_admin", "guard"].includes(accessLevel)) return null;
    user.access_level = accessLevel as AdminUser["access_level"];
    return user;
  } catch {
    return null;
  }
}

export function clearAdminSession() {
  localStorage.removeItem("ebalik_admin_token");
  localStorage.removeItem("ebalik_admin_user");
  localStorage.removeItem("ebalik_token");
  localStorage.removeItem("ebalik_user");
}

// ── Admin CRUD additions: user accounts and walk-in claims ─────────────────
export interface AdminUserInput {
  fname: string;
  mname?: string;
  lname: string;
  email: string;
  campus_id: string;
  user_role: "Student" | "Faculty" | "Staff" | "Others";
}

async function readJsonOrThrow(response: Response, fallback: string) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.error === "string" ? error.error : fallback);
  }
  return response.json();
}

export async function createAdminUser(user: AdminUserInput & { password: string }): Promise<{ user: AdminUserRow; message?: string }> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/users`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(user),
  }, "Create account");
  return readJsonOrThrow(response, "Unable to create the account");
}

export async function updateAdminUser(accountId: string, changes: Partial<AdminUserInput>): Promise<{ user: AdminUserRow; message?: string }> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/users/${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify(changes),
  }, "Update account");
  return readJsonOrThrow(response, "Unable to update the account");
}

export async function createAdminClaim(input: { found_item_reference: string; claimant: string; claim_reason: string; verified_in_person: boolean }): Promise<{ claim: { claim_id: string; claim_reference?: string }; message?: string }> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/claims`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  }, "Record walk-in claim");
  return readJsonOrThrow(response, "Unable to record the claim");
}

export async function updateAdminClaimDetails(claimId: string, claimReason: string): Promise<{ claim: { claim_id: string; claim_reference?: string }; message?: string }> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/claims/${encodeURIComponent(claimId)}`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({ claim_reason: claimReason }),
  }, "Update claim");
  return readJsonOrThrow(response, "Unable to update the claim");
}

// ---- Handover PINs (the guard's release screen) -------------------------------------------------

export interface HandoverClaim {
  claim_id: string;
  claim_reference: string;
  claimant_name: string;
  claimant_campus_id: string;
  item_name: string;
  found_item_reference: string;
  approved_at?: string | null;
}

async function handoverRequest<T>(path: string, pin: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin/claims/handover/${path}`, { method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ pin: pin.replace(/\s/g, "") }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : tr("Unable to use that PIN."));
  return payload as T;
}

/** Find the approved claim that holds this PIN. Nothing is released yet. */
export async function lookupHandoverPin(pin: string): Promise<HandoverClaim> {
  return (await handoverRequest<{ claim: HandoverClaim }>("lookup", pin)).claim;
}

/** Release the item to its owner. Returns the confirmation message. */
export async function releaseByHandoverPin(pin: string): Promise<string> {
  return (await handoverRequest<{ message?: string }>("release", pin)).message ?? tr("The item was released to its owner.");
}

export interface AssignedHandover {
  reference: string;
  item: string;
  category: string;
  storage: string;
  foundDate: string;
  handedOverAt: string;
  guard: string;
  status: string;
}

/** Items finders handed to a guard that are still in custody. A guard sees their own; administrators see every guard's. */
export async function fetchAssignedHandovers(): Promise<{ items: AssignedHandover[]; setupRequired: boolean }> {
  const response = await fetch(`${API_URL}/api/admin/claims/handover/assigned`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : tr("Unable to load the items handed to guards."));
  return { items: (payload.items ?? []) as AssignedHandover[], setupRequired: Boolean(payload.setup_required) };
}

/** Make a new PIN for an approved claim and email it to the claimant. */
export async function reissueHandoverPin(claimId: string): Promise<void> {
  const response = await adminMutationRequest(`${API_URL}/api/admin/claims/${encodeURIComponent(claimId)}/handover-pin`, { method: "POST", headers: getAuthHeaders() }, "Resend Handover PIN");
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : tr("Unable to create a new PIN."));
  }
}

// ---- Dashboard visual analytics ------------------------------------------------------------------

export interface DashboardAnalytics {
  lost_total: number;
  lost_categories: Array<{ name: string; value: number }>;
  lost_by_weekday: Array<{ day: string; name: string; count: number }>;
  lost_by_month: Array<{ key: string; month: string; count: number }>;
  lost_heatmap: { weekdays: string[]; months: Array<{ key: string; label: string; counts: number[] }>; max: number };
  busiest: { weekday: string | null; month: string | null };
  hotspots: Array<{ location: string; lost: number; found: number; total: number }>;
  range: { key: string; start: string | null; end: string | null };
  outcomes: { returned: number; auctioned: number; abandoned: number; in_custody: number; total_found: number; return_rate: number; auction_forfeits?: number | null };
  handover: { released: number | null; awaiting: number | null };
  generated_at?: string;
}

export interface AnalyticsQuery { range?: string; start?: string; end?: string }

export async function fetchDashboardAnalytics(query: AnalyticsQuery = {}): Promise<DashboardAnalytics> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value) params.set(key, value); });
  const response = await fetch(`${API_URL}/api/admin/dashboard/analytics${params.size ? `?${params}` : ""}`, { headers: getAuthHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load analytics");
  return payload as DashboardAnalytics;
}
