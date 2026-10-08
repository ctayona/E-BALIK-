/**
 * Row shapes the admin pages share. They describe what the server sends; there is no sample data here, every list comes from the API.
 *
 * The finished state of anything (a report, an item, a claim, an auction) is called "Completed" everywhere. The database keeps its own
 * words (`returned`, `collected`); the server and these types translate them. See docs/STATUS_GLOSSARY.md.
 */

export interface Claim {
  id: string;
  claimReference?: string;
  foundItemId?: string;
  inAuction?: boolean;
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
  archived?: boolean;
  status: "Under Review" | "Pending" | "Verified" | "Rejected" | "Approved" | "Approved for Pickup" | "Completed" | "Unknown";
}

export interface User {
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

export interface ActivityLog {
  id: string;
  timestamp: string;
  admin: string;
  adminId: string;
  action: string;
  module: string;
  target: string;
  targetId: string;
  result: "Success" | "Warning" | "Error";
}
