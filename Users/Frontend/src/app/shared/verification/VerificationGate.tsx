import { Clock3, ShieldAlert } from "lucide-react";
import { CX } from "@/app/utils/clay";
import { isVerified, useCurrentUser } from "@/app/utils/system";
import type { Page } from "@/app/types";

/**
 * Explains why an action is locked and links to the Profile, where the user uploads an ID.
 * Renders nothing for verified users and admins, so pages can drop it in unconditionally.
 * The server enforces the same rule; this banner only saves the user a failed request.
 */
export default function VerificationGate({ action, onNavigate, className = "" }: { action: string; onNavigate: (page: Page) => void; className?: string }) {
  const user = useCurrentUser();
  if (isVerified(user)) return null;

  const status = String(user?.verification_status || "").toLowerCase();
  const reviewing = status === "pending" && Boolean(user?.verification_document_name);
  const rejected = status === "rejected";
  const Icon = reviewing ? Clock3 : ShieldAlert;
  const title = reviewing ? "Your verification is under review" : rejected ? "Your verification needs attention" : "Verify your account first";
  const body = reviewing
    ? `You can ${action} as soon as an administrator approves your document.`
    : rejected
      ? `Upload a corrected document in your profile to ${action}.`
      : `Only verified accounts can ${action}. Upload a school or government ID in your profile.`;

  return (
    <div role="status" className={`glass relative flex flex-col gap-4 overflow-hidden rounded-[20px] p-5 sm:flex-row sm:items-center ${className}`}>
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-[linear-gradient(180deg,#ecc787,#d1a153)]" aria-hidden="true" />
      <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${reviewing ? "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950" : "bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300"}`} aria-hidden="true"><Icon size={22} /></span>
      <div className="min-w-0 flex-1">
        <p className="font-[family-name:var(--font-heading)] text-[17px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[14px] leading-6 text-ink-muted">{body}</p>
      </div>
      <button type="button" onClick={() => onNavigate("profile")} className={`${CX.btnNavy} shrink-0`}>{reviewing ? "View status" : "Open my profile"}</button>
    </div>
  );
}
