import { useState } from "react";
import { ShieldCheck, UserCog, UserRound, Shield } from "lucide-react";
import type { User } from "../../data/types";
import AdminModal from "../../components/ui/AdminModal";
import { BTN } from "../../components/ui/primitives";
import { tr } from "../../utils/preferences";

type Role = "user" | "guard" | "admin";

const ROLES: Array<{ value: Role; title: string; description: string; icon: typeof UserRound; superOnly?: boolean }> = [
  { value: "user", title: "User", description: "A normal account: reports lost and found items, files claims, bids in the Auction Hall.", icon: UserRound },
  {
    value: "guard",
    title: "Security guard",
    description: "Receives items from finders and releases approved claims at the release desk by Handover PIN. Cannot open any other page, and is signed out after 20 minutes of inactivity.",
    icon: ShieldCheck,
  },
  { value: "admin", title: "Admin", description: "Reviews reports, claims and auctions in this console. Only super admins can delete.", icon: Shield, superOnly: true },
];

/** Pick a person's role. Administrators can make someone a guard; only super admins can make or change an admin. */
export default function RoleModal({ user, isSuperAdmin, busy, onClose, onSave }: { user: User; isSuperAdmin: boolean; busy: boolean; onClose: () => void; onSave: (role: Role) => void }) {
  const current = (user.accessLevel === "super_admin" ? "admin" : user.accessLevel) as Role;
  const [role, setRole] = useState<Role>(current);

  return (
    <AdminModal
      title={tr("Change role for {0}", { "0": user.name })}
      description={tr("Choose what {0} can do in E-Balik. The change applies the next time they sign in or load a page.", { "0": user.name })}
      icon={<UserCog size={20} />}
      tone="navy"
      busy={busy}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={BTN.ghost}>{tr("Cancel")}</button>
        <button type="button" onClick={() => onSave(role)} disabled={busy || role === current} className={BTN.primary}>{busy ? tr("Saving…") : tr("Save role")}</button>
      </>}
    >
      <fieldset className="space-y-3" disabled={busy}>
        <legend className="sr-only">{tr("Role")}</legend>
        {ROLES.map(({ value, title, description, icon: Icon, superOnly }) => {
          const locked = Boolean(superOnly) && !isSuperAdmin;
          const selected = role === value;
          return (
            <label
              key={value}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${selected ? "border-iris-500 bg-iris-50/60" : "border-line bg-[var(--surface)] hover:border-line-strong"} ${locked ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input type="radio" name="role" value={value} checked={selected} disabled={locked} onChange={() => setRole(value)} className="mt-1 size-4 shrink-0" />
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-frost-100 text-iris-600"><Icon size={18} aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-ink">{tr(title)}{value === current && <span className="ml-2 text-[12px] font-medium text-ink-muted">{tr("current")}</span>}</span>
                <span className="mt-0.5 block text-[13.5px] leading-6 text-ink-soft">{tr(description)}</span>
                {locked && <span className="mt-1 block text-[12.5px] font-medium text-ink-muted">{tr("Only super admins can make someone an admin.")}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
    </AdminModal>
  );
}
