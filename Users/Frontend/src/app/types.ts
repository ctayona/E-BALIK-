export type Page = "home" | "dashboard" | "report-item" | "found-item" | "missing-item" | "my-reports" | "matches" | "browse-items" | "claim" | "auction-hall" | "my-tags" | "profile" | "notifications";
export type NavigationOptions = { searchTerm?: string; mode?: "form"; reportId?: string; foundItemId?: string; missingReportId?: string; highlightReportId?: string; reportsTab?: "completed" };
export type ModalState = "none" | "login" | "register";
