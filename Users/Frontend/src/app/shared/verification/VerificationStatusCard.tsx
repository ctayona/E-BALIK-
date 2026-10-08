import { BadgeCheck, Briefcase, Check, Clock3, FileSearch, GraduationCap, Lock, ShieldAlert, ShieldCheck, Upload, UserRound } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { CX, SPRING } from "@/app/utils/clay";
import type { User } from "@/app/utils/useAuth";
import { isDesk } from "@/app/utils/system";

type Status = "verified" | "pending" | "rejected" | "none";

const ROLE_ICONS: Record<string, typeof UserRound> = { Student: GraduationCap, Faculty: BadgeCheck, Staff: Briefcase, Visitor: UserRound };

/** The role an admin assigned. Older accounts only have the legacy `user_role`, where "Others" means Visitor. */
export function assignedRole(user: Pick<User, "user_category" | "user_role" | "verification_status"> | null | undefined): string | null {
  if (!user || String(user.verification_status || "").toLowerCase() !== "verified") return null;
  const category = user.user_category || (user.user_role === "Others" ? "Visitor" : user.user_role);
  return category || "Visitor";
}

function statusOf(user: User | null): Status {
  const value = String(user?.verification_status || "").toLowerCase();
  if (value === "verified") return "verified";
  if (value === "rejected") return "rejected";
  if (value === "pending" && user?.verification_document_name) return "pending";
  return "none";
}

const LOOK: Record<Status, { title: string; lead: string; seal: string; Icon: typeof ShieldCheck }> = {
  verified: {
    title: "Verified",
    lead: "An administrator confirmed your identity. Everything in E-Balik is unlocked.",
    seal: "bg-[linear-gradient(145deg,#9fe0ca,#3fbf9f)] text-white shadow-[0_14px_30px_-14px_rgba(63,191,159,0.95)]",
    Icon: ShieldCheck,
  },
  pending: {
    title: "Under review",
    lead: "Your document is with an administrator. You will get a notification as soon as it is reviewed.",
    seal: "bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950 shadow-[0_14px_30px_-14px_rgba(209,161,83,0.95)]",
    Icon: Clock3,
  },
  rejected: {
    title: "Needs attention",
    lead: "Your document could not be accepted. Read the note below and upload a corrected one.",
    seal: "bg-[linear-gradient(145deg,#fda4af,#e11d48)] text-white shadow-[0_14px_30px_-14px_rgba(225,29,72,0.8)]",
    Icon: ShieldAlert,
  },
  none: {
    title: "Not verified yet",
    lead: "Upload a school or government ID. Until an administrator approves it you can browse, but not report, claim or bid.",
    seal: "bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300 shadow-[0_14px_30px_-14px_rgba(17,27,66,0.9)]",
    Icon: ShieldAlert,
  },
};

const UNLOCKS = ["Report a lost item", "Report a found item", "File an ownership claim", "Bid in the Auction Hall"];

/** Profile hero: verification status, assigned role, review progress and what each state unlocks. */
export default function VerificationStatusCard({ user, busy, onUpload }: { user: User | null; busy: boolean; onUpload: () => void }) {
  const reduced = useReducedMotion();
  // Guards and administrators never need an ID check: everything is already unlocked for them, so there is nothing to show.
  if (isDesk(user)) return null;
  const status = statusOf(user);
  const look = LOOK[status];
  const role = assignedRole(user);
  const RoleIcon = role ? ROLE_ICONS[role] ?? UserRound : UserRound;
  const unlocked = status === "verified";
  const steps = [
    { label: "Document uploaded", done: status !== "none" },
    { label: "Administrator review", done: status === "verified" || status === "rejected", active: status === "pending" },
    { label: "Verified with a role", done: status === "verified" },
  ];

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      aria-labelledby="verification-heading"
      className={`${CX.card} relative mb-6 overflow-hidden`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_0%_0%,rgba(110,142,240,0.12),transparent),radial-gradient(50%_90%_at_100%_0%,rgba(209,161,83,0.14),transparent)]" aria-hidden="true" />
      <div className="relative grid gap-6 p-6 md:grid-cols-[auto_minmax(0,1fr)] md:p-8">
        <span className={`flex size-[72px] shrink-0 items-center justify-center rounded-[22px] ${look.seal}`} aria-hidden="true"><look.Icon size={34} /></span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 id="verification-heading" className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight text-ink">{look.title}</h2>
            {role && (
              <span className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(145deg,#2b4282,#1f3160)] py-1.5 pl-2 pr-4 text-[14px] font-semibold text-white shadow-[0_10px_22px_-12px_rgba(17,27,66,0.9)]" aria-label={`Role: ${role}`}>
                <span className="flex size-6 items-center justify-center rounded-full bg-gold-500 text-navy-950"><RoleIcon size={14} aria-hidden="true" /></span>
                {role}
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-[60ch] text-[15px] leading-6 text-ink-muted">{look.lead}</p>

          {status === "rejected" && user?.verification_review_note && (
            <p className={`${CX.alertError} mt-4`} role="alert"><span className="font-semibold">Administrator note:</span> {user.verification_review_note}</p>
          )}
          {user?.verification_document_name && status !== "none" && (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-muted"><FileSearch size={15} aria-hidden="true" />{status === "verified" ? "Verified with" : "Submitted"}: <span className="font-semibold text-ink">{user.verification_document_name}</span></p>
          )}

          <ol className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2" aria-label="Verification progress">
            {steps.map((step, index) => (
              <li key={step.label} className="flex items-center gap-2.5 sm:flex-1">
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ring-1 ${step.done ? "bg-tide-500 text-white ring-tide-500" : step.active ? "bg-gold-500 text-navy-950 ring-gold-500 animate-pulse" : "bg-white text-ink-muted ring-line-strong"}`}>
                  {step.done ? <Check size={14} aria-hidden="true" /> : index + 1}
                </span>
                <span className={`text-[13.5px] font-medium ${step.done || step.active ? "text-ink" : "text-ink-muted"}`}>{step.label}</span>
                {index < steps.length - 1 && <span className={`hidden h-px flex-1 sm:block ${step.done ? "bg-tide-500" : "bg-line-strong"}`} aria-hidden="true" />}
              </li>
            ))}
          </ol>

          <ul className="mt-6 grid gap-2 sm:grid-cols-2" aria-label="What you can do">
            {UNLOCKS.map((label) => (
              <li key={label} className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[14px] font-medium ring-1 ${unlocked ? "bg-tide-50/70 text-ink ring-tide-200" : "bg-frost-50 text-ink-muted ring-line"}`}>
                {unlocked ? <Check size={16} className="shrink-0 text-tide-600" aria-hidden="true" /> : <Lock size={15} className="shrink-0" aria-hidden="true" />}
                {label}
                <span className="sr-only">{unlocked ? "unlocked" : "locked until verified"}</span>
              </li>
            ))}
          </ul>

          {status !== "verified" && (
            <motion.button
              type="button"
              onClick={onUpload}
              disabled={busy}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              transition={SPRING}
              className={`${CX.btnGold} mt-6`}
            >
              <Upload size={16} aria-hidden="true" />
              {busy ? "Uploading…" : status === "pending" ? "Replace document" : status === "rejected" ? "Upload a corrected document" : "Upload your ID"}
            </motion.button>
          )}
        </div>
      </div>
    </motion.section>
  );
}
