import { useCallback, useEffect, useState } from "react";
import { KeyRound, RefreshCw, ShieldAlert, ShieldCheck, UserMinus } from "lucide-react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { BTN } from "../../components/ui/primitives";
import { DataTable, RowActions, StatusPill } from "../../components/ui/management";
import { fetchAdmins, revokeAdminAccess, type AdminAccount } from "../../utils/missionApi";
import { formatDateTime } from "../../utils/countdown";
import { tr } from "../../utils/preferences";
import { Card, ErrorNote } from "./parts";

/** Every admin and super admin in one table, with a one-click way to take their access away (for example when an OHSO employee leaves). */
export default function AdminGovernance() {
  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [you, setYou] = useState("");
  const [error, setError] = useState("");
  const [target, setTarget] = useState<AdminAccount | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchAdmins();
      setAdmins(data.admins);
      setYou(data.you);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to load the administrators."));
      setAdmins((current) => current ?? []);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const revoke = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await revokeAdminAccess(target.account_id);
      await load();
    } catch {
      // The API helper already showed the reason in the result dialog.
    } finally {
      setBusy(false);
      setTarget(null);
    }
  };

  const withoutMfa = (admins ?? []).filter((admin) => !admin.mfa_enabled).length;
  const supers = (admins ?? []).filter((admin) => admin.level === "super_admin" && admin.is_active).length;

  return (
    <Card
      icon={<KeyRound size={21} />}
      tone="danger"
      title={tr("Admin access governance")}
      description={tr("Everyone who can sign in to this console. Revoke access at once when someone leaves; they become a standard user and their admin session stops working on the next click.")}
      aside={<button type="button" onClick={() => void load()} className={BTN.ghost}><RefreshCw size={15} aria-hidden="true" />{tr("Refresh")}</button>}
    >
      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      {admins === null ? <SkeletonBlock className="h-40 w-full rounded-2xl" /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
            <StatusPill tone="slate">{tr("{0} accounts", { "0": admins.length })}</StatusPill>
            <StatusPill tone="iris">{tr("{0} super admin(s)", { "0": supers })}</StatusPill>
            {withoutMfa > 0 ? <StatusPill tone="gold">{tr("{0} without two-factor", { "0": withoutMfa })}</StatusPill> : admins.length > 0 && <StatusPill tone="mint">{tr("All use two-factor")}</StatusPill>}
          </div>
          <DataTable
            caption={tr("Administrators")}
            minWidth={820}
            columns={[
              { key: "who", label: "Administrator" },
              { key: "role", label: "Role" },
              { key: "mfa", label: "Two-factor" },
              { key: "login", label: "Last sign-in" },
              { key: "actions", label: "Access" },
            ]}
            isEmpty={admins.length === 0}
            empty={tr("No administrators were found.")}
          >
            {admins.map((admin) => {
              const me = admin.account_id === you;
              return (
                <tr key={admin.account_id} data-tone={admin.level === "super_admin" ? "iris" : "slate"}>
                  <td>
                    <div className="font-semibold text-ink">{admin.name}{me && <span className="ml-2 text-[12px] font-medium text-ink-muted">{tr("(you)")}</span>}</div>
                    <div className="max-w-[260px] truncate text-[12.5px] text-ink-muted" title={admin.email}>{admin.email}</div>
                  </td>
                  <td><div className="flex flex-wrap gap-1.5"><StatusPill tone={admin.level === "super_admin" ? "iris" : "slate"}>{admin.level === "super_admin" ? tr("Super admin") : tr("Admin")}</StatusPill>{!admin.is_active && <StatusPill tone="rose">{tr("Suspended")}</StatusPill>}</div></td>
                  <td>{admin.mfa_enabled ? <span className="inline-flex items-center gap-1.5 text-[13px] text-[#1b7863] dark:text-[#6fd6bb]"><ShieldCheck size={15} aria-hidden="true" />{tr("On")}</span> : <span className="inline-flex items-center gap-1.5 text-[13px] text-gold-700 dark:text-gold-300"><ShieldAlert size={15} aria-hidden="true" />{tr("Off")}</span>}</td>
                  <td className="whitespace-nowrap text-[13px] text-ink-muted">{admin.last_login_at ? formatDateTime(admin.last_login_at) : "—"}</td>
                  <RowActions>
                    <button type="button" disabled={me} title={me ? tr("You cannot revoke your own access") : undefined} onClick={() => setTarget(admin)} className={`${BTN.danger} !min-h-[38px] px-3 text-[13px]`}>
                      <UserMinus size={15} aria-hidden="true" />{tr("Revoke access")}
                    </button>
                  </RowActions>
                </tr>
              );
            })}
          </DataTable>
        </>
      )}

      {target && (
        <ConfirmActionDialog
          title={tr("revoke the admin access of {0}", { "0": target.name })}
          description={tr("{0} ({1}) becomes a standard user right now and is told. Their open admin session stops working. {2}", {
            "0": target.name, "1": target.email,
            "2": target.level === "super_admin" ? tr("This is a super administrator; the last active one cannot be revoked.") : tr("You can promote them again later from the Users page."),
          })}
          confirmLabel="Revoke access"
          danger
          busy={busy}
          onCancel={() => { if (!busy) setTarget(null); }}
          onConfirm={() => void revoke()}
        />
      )}
    </Card>
  );
}
