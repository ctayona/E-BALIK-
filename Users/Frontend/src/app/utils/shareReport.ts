import { showToast } from "@/app/shared/toast/toastStore";

/** The link a report is shared with. Opening it signs the person in as usual, then shows the report at the top of the home feed. */
export const reportLink = (reference: string) => `${window.location.origin}/?report=${encodeURIComponent(reference)}`;

/** Found reports are FP..., missing reports MP...; anything else is not a report reference. */
export function kindOfReference(reference: string): "found" | "missing" | null {
  if (/^FP/i.test(reference)) return "found";
  if (/^MP/i.test(reference)) return "missing";
  return null;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and pages without clipboard permission: copy through a hidden box.
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(box);
    box.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(box);
    }
  }
}

/** Share button: copy the report's link and say so. */
export async function shareReport(reference: string) {
  const link = reportLink(reference);
  if (await copyText(link)) showToast("Report link copied");
  else showToast(`Could not copy automatically. The link is ${link}`, "error");
}
