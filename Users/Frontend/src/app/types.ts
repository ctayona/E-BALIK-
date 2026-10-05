export type Page = "home" | "dashboard" | "report-item" | "found-item" | "missing-item" | "my-reports" | "matches" | "browse-items" | "claim" | "auction-hall" | "profile" | "notifications";
export type NavigationOptions = { searchTerm?: string; mode?: "form"; reportId?: string; foundItemId?: string; missingReportId?: string; highlightReportId?: string };
export type ModalState = "none" | "login" | "register";
