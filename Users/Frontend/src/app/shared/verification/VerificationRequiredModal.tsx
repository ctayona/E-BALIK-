import { useCallback, useState, type ReactNode } from "react";
import { Clock3, ShieldAlert } from "lucide-react";
import Modal from "@/app/shared/modal/Modal";
import { CX } from "@/app/utils/clay";
import { authUtils } from "@/app/utils/api";
import { isVerified } from "@/app/utils/system";
import type { Page } from "@/app/types";

/**
 * The pop-up an unverified person gets when they open a public report: it says why, and one button goes straight to the Profile page
 * to upload an ID. The server enforces the same rule for every action; this only saves a dead end.
 */
export function VerificationRequiredModal({ open, onClose, onNavigate, action = "view this report" }: { open: boolean; onClose: () => void; onNavigate?: (page: Page) => void; action?: string }) {
  const user = authUtils.getUserData() as { verification_status?: string; verification_document_name?: string } | null;
  const status = String(user?.verification_status || "").toLowerCase();
  const reviewing = status === "pending" && Boolean(user?.verification_document_name);
  const rejected = status === "rejected";
  const title = reviewing ? "Your verification is under review" : rejected ? "Your ID needs attention" : "Verify your ID first";
  const body = reviewing
    ? `An administrator is checking your ID. You can ${action} as soon as it is approved.`
    : rejected
      ? `Your last ID was not approved. Upload a clear, corrected photo of your school or government ID to ${action}.`
      : `To ${action}, your account must be verified. Upload a school or government ID in your profile and an administrator will check it.`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      tone={reviewing ? "gold" : "iris"}
      icon={reviewing ? <Clock3 size={21} /> : <ShieldAlert size={21} />}
      title={title}
      description={body}
      footer={<>
        <button type="button" onClick={onClose} className={CX.btnGhost}>Not now</button>
        <button type="button" onClick={() => { onClose(); onNavigate?.("profile"); }} className={CX.btnNavy}>{reviewing ? "View my verification" : "Go to my profile to verify"}</button>
      </>}
    >
      <p className="text-[13.5px] leading-6 text-ink-muted">This keeps lost-and-found details limited to people the university has confirmed.</p>
    </Modal>
  );
}

/**
 * `guard(action)` runs `action` for a verified person (or staff) and otherwise opens the pop-up instead.
 * Render `prompt` once in the page.
 */
export function useVerificationPrompt(onNavigate?: (page: Page) => void, action?: string): { guard: <T extends unknown[]>(run: (...args: T) => void) => (...args: T) => void; ensure: () => boolean; prompt: ReactNode } {
  const [open, setOpen] = useState(false);
  const ensure = useCallback(() => {
    if (isVerified(authUtils.getUserData() as { verification_status?: string; access_level?: string } | null)) return true;
    setOpen(true);
    return false;
  }, []);
  const guard = useCallback(<T extends unknown[]>(run: (...args: T) => void) => (...args: T) => { if (ensure()) run(...args); }, [ensure]);
  return { guard, ensure, prompt: <VerificationRequiredModal open={open} onClose={() => setOpen(false)} onNavigate={onNavigate} action={action} /> };
}
