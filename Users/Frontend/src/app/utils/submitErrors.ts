import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";

/**
 * One place that turns a failed report, claim or verification submission into the right message box.
 * Rule violations (report limit, duplicates, missing consent) get their own explanation; anything else
 * falls back to the caller's generic title.
 */
export function showSubmitError(result: { error?: string; errorCode?: string }, fallbackTitle: string, fallbackMessage: string) {
  const message = result.error || fallbackMessage;
  switch (result.errorCode) {
    case "report_limit":
      showInfoModal({
        variant: "warning",
        title: "Report limit reached",
        message,
        details: ["You can have up to 6 active reports at a time.", "Open My Reports to mark one resolved or delete it, then try again."],
        autoCloseMs: null,
      });
      return;
    case "duplicate_report":
      showInfoModal({
        variant: "warning",
        title: "This looks like a duplicate",
        message,
        details: ["Reports with the same item and a very similar description are blocked to keep matching accurate.", "If this is a different item, make the description more specific and submit again."],
        autoCloseMs: null,
      });
      return;
    case "duplicate_submission":
    case "duplicate_claim":
      showInfoModal({ variant: "info", title: "Already submitted", message, details: ["Check Claim history or My Reports to see it."], autoCloseMs: null });
      return;
    case "dpa_required":
      showInfoModal({ variant: "warning", title: "Consent required", message, autoCloseMs: null });
      return;
    default:
      showInfoModal({ variant: "error", title: fallbackTitle, message });
  }
}
