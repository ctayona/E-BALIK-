export interface LostItem {
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
  status: "Searching" | "Potential Match" | "Resolved" | "Expired";
}

export interface FoundItem {
  id: string;
  item: string;
  description: string;
  category: string;
  locationFound: string;
  dateFound: string;
  storage: string;
  aiStatus: string;
  aiPercent: number | null;
  matchedItem?: string;
  status: "Ready to Release" | "Under Review" | "Released" | "Claimed" | "Unclaimed" | "Auctioned";
  photo?: string;
}

export interface Claim {
  id: string;
  claimReference?: string;
  foundItemId?: string;
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

export interface Notification {
  id: string;
  title: string;
  message: string;
  priority: "High" | "Medium" | "Low";
  time: string;
  read: boolean;
  type: "claim" | "ai" | "item" | "system";
}

export const lostItems: LostItem[] = [
  { id: "EB-L-2026-001", item: "iPhone 13", description: "Black · Apple", category: "Electronics", location: "Library", dateLost: "Aug 15, 2026", reportedBy: "Juan Dela Cruz", studentId: "2023-10234", aiMatch: 94, status: "Potential Match" },
  { id: "EB-L-2026-002", item: "AirPods Pro (2nd Gen)", description: "White · Apple", category: "Electronics", location: "Gymnasium", dateLost: "Aug 14, 2026", reportedBy: "Maria Santos", studentId: "2022-08812", aiMatch: 78, status: "Searching" },
  { id: "EB-L-2026-003", item: "Blue Canvas Backpack", description: "Navy Blue · Herschel", category: "Bags", location: "Cafeteria", dateLost: "Aug 13, 2026", reportedBy: "Carlos Reyes", studentId: "2024-11203", aiMatch: null, status: "Searching" },
  { id: "EB-L-2026-004", item: "Student ID Card", description: "White · N/A", category: "Documents", location: "Admin Building", dateLost: "Aug 12, 2026", reportedBy: "Ana Rodriguez", studentId: "2021-05567", aiMatch: null, status: "Resolved" },
  { id: "EB-L-2026-005", item: "Galaxy Watch 5", description: "Black · Samsung", category: "Electronics", location: "Oval Track", dateLost: "Aug 11, 2026", reportedBy: "Miguel Torres", studentId: "2023-07890", aiMatch: 88, status: "Potential Match" },
  { id: "EB-L-2026-006", item: "YETI Water Bottle", description: "Teal · YETI", category: "Personal Items", location: "Engineering Building", dateLost: "Aug 10, 2026", reportedBy: "Sofia Lim", studentId: "2022-13456", aiMatch: 71, status: "Searching" },
  { id: "EB-L-2026-007", item: "MacBook Charger", description: "White · Apple 30W USB-C", category: "Electronics", location: "Library", dateLost: "Aug 9, 2026", reportedBy: "Diego Fernandez", studentId: "2023-09901", aiMatch: 82, status: "Potential Match" },
  { id: "EB-L-2026-008", item: "Scientific Calculator", description: "Black · Casio fx-991", category: "School Supplies", location: "Engineering Building", dateLost: "Aug 8, 2026", reportedBy: "Rafael Morales", studentId: "2024-15678", aiMatch: null, status: "Searching" },
  { id: "EB-L-2026-009", item: "Canvas Tote Bag", description: "Brown · Generic", category: "Bags", location: "Cafeteria", dateLost: "Aug 7, 2026", reportedBy: "Lena Villanueva", studentId: "2022-09321", aiMatch: null, status: "Searching" },
  { id: "EB-L-2026-010", item: "Student Planner", description: "Blue · BTS", category: "School Supplies", location: "Library", dateLost: "Aug 6, 2026", reportedBy: "Marco Bautista", studentId: "2023-14532", aiMatch: null, status: "Expired" },
];

export const foundItems: FoundItem[] = [
  { id: "EB-F-2026-042", item: "iPhone 13", description: "Black iPhone 13 found on library table", category: "Electronics", locationFound: "Library — Study Area B", dateFound: "Aug 16, 2026", storage: "Admin Locker A-12", aiStatus: "Matched", aiPercent: 94, status: "Ready to Release" },
  { id: "EB-F-2026-041", item: "AirPods Case", description: "White AirPods Pro charging case", category: "Electronics", locationFound: "Gymnasium Locker Room", dateFound: "Aug 15, 2026", storage: "Admin Locker A-09", aiStatus: "Matched", aiPercent: 78, status: "Under Review" },
  { id: "EB-F-2026-040", item: "MacBook Charger", description: "Apple 30W USB-C charger", category: "Electronics", locationFound: "Library — Charging Station 3", dateFound: "Aug 12, 2026", storage: "Admin Locker A-07", aiStatus: "Matched", aiPercent: 82, status: "Under Review" },
  { id: "EB-F-2026-039", item: "Samsung Galaxy Watch", description: "Black smartwatch found near bleachers", category: "Electronics", locationFound: "Oval Track — East Bleachers", dateFound: "Aug 11, 2026", storage: "Admin Locker B-02", aiStatus: "Matched", aiPercent: 88, status: "Ready to Release" },
  { id: "EB-F-2026-038", item: "Canvas Tote Bag", description: "Brown canvas tote with books inside", category: "Bags", locationFound: "Cafeteria — Table 14", dateFound: "Aug 19, 2026", storage: "Admin Locker B-05", aiStatus: "No Match", aiPercent: null, status: "Unclaimed" },
  { id: "EB-F-2026-037", item: "YETI Water Bottle", description: "Teal YETI 20oz bottle", category: "Personal Items", locationFound: "Engineering Building Hallway", dateFound: "Aug 10, 2026", storage: "Admin Locker C-01", aiStatus: "Matched", aiPercent: 71, status: "Released" },
];

export const claims: Claim[] = [
  { id: "EB-C-2026-012", claimant: "Juan Dela Cruz", studentId: "2023-10234", item: "iPhone 13", itemId: "EB-F-2026-042", submitted: "Aug 17, 2026", status: "Under Review" },
  { id: "EB-C-2026-011", claimant: "Miguel Torres", studentId: "2023-07890", item: "Galaxy Watch 5", itemId: "EB-F-2026-039", submitted: "Aug 16, 2026", status: "Pending" },
  { id: "EB-C-2026-010", claimant: "Maria Santos", studentId: "2022-08812", item: "AirPods Pro", itemId: "EB-F-2026-041", submitted: "Aug 15, 2026", status: "Pending" },
  { id: "EB-C-2026-009", claimant: "Diego Fernandez", studentId: "2023-09901", item: "MacBook Charger", itemId: "EB-F-2026-040", submitted: "Aug 14, 2026", status: "Verified" },
  { id: "EB-C-2026-008", claimant: "Sofia Lim", studentId: "2022-13456", item: "YETI Bottle", itemId: "EB-F-2026-037", submitted: "Aug 13, 2026", status: "Rejected" },
];

export const users: User[] = [
  { id: "1", name: "Juan Dela Cruz", initials: "JD", studentId: "2023-10234", email: "jdelacruz@umak.edu.ph", program: "BS Computer Science", reports: 3, claims: 2, status: "Active", accessLevel: "user", lastActivity: "2 hours ago" },
  { id: "2", name: "Maria Santos", initials: "MS", studentId: "2022-08812", email: "masantos@umak.edu.ph", program: "BS Psychology", reports: 1, claims: 1, status: "Active", accessLevel: "user", lastActivity: "1 day ago" },
  { id: "3", name: "Carlos Reyes", initials: "CR", studentId: "2024-11203", email: "creyes@umak.edu.ph", program: "BS Agriculture", reports: 2, claims: 0, status: "Active", accessLevel: "user", lastActivity: "3 days ago" },
  { id: "4", name: "Ana Rodriguez", initials: "AR", studentId: "2021-05567", email: "arodriguez@umak.edu.ph", program: "BS Biology", reports: 4, claims: 3, status: "Active", accessLevel: "user", lastActivity: "5 hours ago" },
  { id: "5", name: "Miguel Torres", initials: "MT", studentId: "2023-07890", email: "matorres@umak.edu.ph", program: "BS Civil Engineering", reports: 1, claims: 1, status: "Active", accessLevel: "user", lastActivity: "12 hours ago" },
  { id: "6", name: "Sofia Lim", initials: "SL", studentId: "2022-13456", email: "slim@umak.edu.ph", program: "BS Nursing", reports: 2, claims: 1, status: "Suspended", accessLevel: "user", lastActivity: "5 days ago" },
  { id: "7", name: "Diego Fernandez", initials: "DF", studentId: "2023-09901", email: "dfernandez@umak.edu.ph", program: "BS Architecture", reports: 1, claims: 1, status: "Active", accessLevel: "user", lastActivity: "2 days ago" },
  { id: "8", name: "Rafael Morales", initials: "RM", studentId: "2024-15678", email: "rmorales@umak.edu.ph", program: "BS Electrical Engineering", reports: 1, claims: 0, status: "Active", accessLevel: "user", lastActivity: "6 hours ago" },
];

export const activityLogs: ActivityLog[] = [
  { id: "LOG-2026-0842", timestamp: "Aug 19, 2026 — 10:42 AM", admin: "Maria Gonzales", adminId: "ADM-003", action: "Claim Approved", module: "Claims & Verification", target: "Juan Dela Cruz", targetId: "EB-C-2026-012", result: "Success" },
  { id: "LOG-2026-0841", timestamp: "Aug 19, 2026 — 10:31 AM", admin: "AI System", adminId: "AI-ENGINE", action: "Match Detected", module: "AI Matching", target: "EB-L-2026-001 ↔ E...", targetId: "M-001", result: "Success" },
  { id: "LOG-2026-0840", timestamp: "Aug 19, 2026 — 09:15 AM", admin: "Maria Gonzales", adminId: "ADM-003", action: "Found Item Registered", module: "Found Items", target: "Canvas Tote Bag", targetId: "EB-F-2026-038", result: "Success" },
  { id: "LOG-2026-0839", timestamp: "Aug 19, 2026 — 08:50 AM", admin: "Carlos Mañalac", adminId: "ADM-007", action: "User Account Rejected", module: "Users", target: "Sofia Lim", targetId: "2022-13456", result: "Warning" },
  { id: "LOG-2026-0838", timestamp: "Aug 18, 2026 — 4:55 PM", admin: "Maria Gonzales", adminId: "ADM-003", action: "Claim Rejected", module: "Claims & Verification", target: "Sofia Lim", targetId: "EB-C-2026-008", result: "Success" },
  { id: "LOG-2026-0837", timestamp: "Aug 18, 2026 — 3:42 PM", admin: "Maria Gonzales", adminId: "ADM-003", action: "Item Released", module: "Chain of Custody", target: "iPhone 13 → Juan D...", targetId: "EB-F-2026-042", result: "Success" },
  { id: "LOG-2026-0836", timestamp: "Aug 18, 2026 — 3:10 PM", admin: "AI System", adminId: "AI-ENGINE", action: "Match Detected", module: "AI Matching", target: "EB-L-2026-005 ↔ ...", targetId: "M-002", result: "Success" },
  { id: "LOG-2026-0835", timestamp: "Aug 18, 2026 — 1:22 PM", admin: "Maria Gonzales", adminId: "ADM-003", action: "Lost Item Updated", module: "Lost Items", target: "AirPods Pro", targetId: "EB-L-2026-002", result: "Success" },
];

export const notifications: Notification[] = [
  { id: "1", title: "Claim Requires Verification", message: "Claim EB-C-2026-012 by Juan Dela Cruz needs admin review for iPhone 13.", priority: "High", time: "10 minutes ago", read: false, type: "claim" },
  { id: "2", title: "Potential AI Match Detected", message: "System found 94% match between EB-L-2026-001 and EB-F-2026-042.", priority: "High", time: "2 hours ago", read: false, type: "ai" },
  { id: "3", title: "New Claim Submitted", message: "Miguel Torres submitted a claim for Galaxy Watch 5 (EB-C-2026-011).", priority: "Medium", time: "3 hours ago", read: false, type: "claim" },
  { id: "4", title: "New Lost Item Report", message: "Rafael Morales reported a lost Casio scientific calculator in Engineering Building.", priority: "Medium", time: "5 hours ago", read: false, type: "item" },
  { id: "5", title: "New Found Item Registered", message: "Admin registered Canvas Tote Bag found at Cafeteria (EB-F-2026-038).", priority: "Low", time: "6 hours ago", read: true, type: "item" },
  { id: "6", title: "Item Overdue for Release", message: "YETI Bottle (EB-F-2026-037) has been in custody for over 30 days.", priority: "Low", time: "1 day ago", read: true, type: "system" },
];

export const aiMatches = [
  { id: "M-001", status: "Needs Review", lostId: "EB-L-2026-001", lostItem: "iPhone 13", lostDesc: "Black", lostLocation: "Library", lostDate: "Aug 15", foundId: "EB-F-2026-042", foundItem: "iPhone 13", foundDesc: "Midnight", foundLocation: "Library", foundDate: "Aug 16", matchPercent: 94, visualSim: 96, descSim: 92, locationSim: 100, timeSim: 88 },
  { id: "M-002", status: "Needs Review", lostId: "EB-L-2026-005", lostItem: "Galaxy Watch 5", lostDesc: "Black", lostLocation: "Oval Track", lostDate: "Aug 11", foundId: "EB-F-2026-039", foundItem: "Samsung Smartwatch", foundDesc: "Black", foundLocation: "Oval Track", foundDate: "Aug 11", matchPercent: 88, visualSim: 90, descSim: 85, locationSim: 100, timeSim: 95 },
  { id: "M-003", status: "High Confidence", lostId: "EB-L-2026-007", lostItem: "MacBook Charger", lostDesc: "White · Apple", lostLocation: "Library", lostDate: "Aug 9", foundId: "EB-F-2026-040", foundItem: "MacBook Charger", foundDesc: "Apple 30W USB-C", foundLocation: "Library", foundDate: "Aug 12", matchPercent: 82, visualSim: 88, descSim: 95, locationSim: 100, timeSim: 75 },
  { id: "M-004", status: "High Confidence", lostId: "EB-L-2026-002", lostItem: "AirPods Pro", lostDesc: "White · Apple", lostLocation: "Gymnasium", lostDate: "Aug 14", foundId: "EB-F-2026-041", foundItem: "AirPods Case", foundDesc: "White charging case", foundLocation: "Gymnasium", foundDate: "Aug 15", matchPercent: 78, visualSim: 80, descSim: 76, locationSim: 100, timeSim: 70 },
  { id: "M-005", status: "Confirmed", lostId: "EB-L-2026-004", lostItem: "Student ID Card", lostDesc: "White", lostLocation: "Admin Building", lostDate: "Aug 12", foundId: "EB-F-2026-037", foundItem: "ID Card", foundDesc: "Found at corridor", foundLocation: "Admin Building", foundDate: "Aug 12", matchPercent: 99, visualSim: 99, descSim: 98, locationSim: 100, timeSim: 100 },
];

export const chartData = [
  { month: "Mar", lost: 16, found: 14 },
  { month: "Apr", lost: 22, found: 16 },
  { month: "May", lost: 15, found: 13 },
  { month: "Jun", lost: 28, found: 21 },
  { month: "Jul", lost: 24, found: 18 },
  { month: "Aug", lost: 21, found: 12 },
];

export const categoryData = [
  { name: "Electronics", value: 54, color: "#1a2747" },
  { name: "Bags", value: 21, color: "#3b82f6" },
  { name: "Personal Items", value: 28, color: "#0d9488" },
  { name: "Documents", value: 12, color: "#7c3aed" },
  { name: "School Supplies", value: 9, color: "#f59e0b" },
  { name: "Clothing", value: 4, color: "#94a3b8" },
];
