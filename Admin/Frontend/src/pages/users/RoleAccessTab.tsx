import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Crown, KeyRound, Lock, RotateCcw, Save, ShieldCheck, UserCog } from "lucide-react";
import { BTN } from "../../components/ui/primitives";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { Toggle } from "../system-control/parts";
import { fetchRoleAccess, saveRoleAccess, type RoleAccess, type StaffRole } from "../../utils/accessApi";
import { tr } from "../../utils/preferences";

const ROLE_INFO: Record<StaffRole | "super_admin", { label: string; note: string; icon: React.ReactNode }> = {
  super_admin: { label: "Super admin", note: "Every page, always", icon: <Crown size={16} aria-hidden="true" /> },
  admin: { label: "Admin", note: "Office staff", icon: <UserCog size={16} aria-hidden="true" /> },
  guard: { label: "Guard", note: "Release desk staff", icon: <KeyRound size={16} aria-hidden="true" /> },
};
const ROLES: StaffRole[] = ["admin", "guard"];

/**
 * Users > Role access: which console pages each role may open. Super admins always have everything; super-admin pages
 * (System control, Recycle bin) cannot be granted; the dashboard and My profile are always open to administrators.
 * The server enforces the same matrix on every admin API call.
 */
export default function RoleAccessTab() {
  const [data, setData] = useState<RoleAccess | null>(null);
  const [draft, setDraft] = useState<Record<StaffRole, string[]> | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const value = await fetchRoleAccess();
      setData(value);
      setDraft(value.matrix);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : tr("Unable to load role access."));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => Boolean(data && draft && ROLES.some((role) => [...draft[role]].sort().join() !== [...data.matrix[role]].sort().join())), [data, draft]);

  const toggle = (role: StaffRole, page: string, on: boolean) => {
    setDraft((current) => current && ({ ...current, [role]: on ? [...current[role], page] : current[role].filter((id) => id !== page) }));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await saveRoleAccess(draft);
      setData((current) => current && { ...current, matrix: result.matrix });
      setDraft(result.matrix);
    } catch (failure) {
      showInfoModal({ variant: "error", title: tr("Role access not saved"), message: failure instanceof Error ? failure.message : tr("Try again.") });
    } finally {
      setSaving(false);
    }
  };

  if (error) return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-800">{error}</p>;
  if (!data || !draft) return <SkeletonBlock className="h-[420px] w-full rounded-[24px]" />;

  return (
    <section className="space-y-4">
      <div className="glass-panel flex flex-wrap items-center gap-4 p-5 sm:p-6">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#2b4282,#1f3160)] text-gold-300 shadow-[0_0_0_4px_rgba(255,255,255,0.7)] dark:shadow-none" aria-hidden="true"><ShieldCheck size={22} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-[family-name:var(--font-heading)] text-[19px] font-semibold text-ink">{tr("Role access")}</h2>
          <p className="mt-0.5 max-w-[70ch] text-[13.5px] leading-5 text-ink-muted">{tr("Choose which console pages each role can open. The server enforces it on every request, so a hidden page cannot be reached another way. Changes apply when staff next open or refresh the console.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDraft({ admin: data.defaults.admin, guard: data.defaults.guard })} className={BTN.ghost} disabled={saving}><RotateCcw size={16} aria-hidden="true" />{tr("Restore defaults")}</button>
          <button type="button" onClick={() => void save()} className={BTN.primary} disabled={!dirty || saving}>{saving ? tr("Saving…") : <><Save size={16} aria-hidden="true" />{tr("Save changes")}</>}</button>
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="mgmt-scroll">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">{tr("Pages each role may open")}</caption>
            <thead>
              <tr className="border-b border-line bg-frost-50/80">
                <th scope="col" className="px-5 py-3.5 text-[13px] font-semibold text-ink-muted">{tr("Page")}</th>
                {(["super_admin", ...ROLES] as const).map((role) => (
                  <th key={role} scope="col" className="w-[160px] px-4 py-3.5 text-center">
                    <span className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">{ROLE_INFO[role].icon}{tr(ROLE_INFO[role].label)}</span>
                    <span className="block text-[11.5px] font-normal text-ink-muted">{tr(ROLE_INFO[role].note)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.admin_pages.map((page) => (
                <tr key={page.id} className="transition-colors hover:bg-frost-50/60">
                  <th scope="row" className="px-5 py-3 text-[14px] font-medium text-ink">
                    {tr(page.label)}
                    {page.super_only && <span className="ml-2 rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-semibold text-gold-800 ring-1 ring-gold-200 dark:bg-gold-500/10 dark:text-gold-200 dark:ring-gold-400/30">{tr("Super admin only")}</span>}
                  </th>
                  <td className="px-4 py-3 text-center"><span className="inline-flex size-8 items-center justify-center rounded-full bg-tide-50 text-tide-700 dark:bg-tide-500/15 dark:text-tide-300" aria-label={tr("Allowed")}><Check size={16} aria-hidden="true" /></span></td>
                  {ROLES.map((role) => {
                    const fixedOn = role === "admin" && page.always;
                    const fixedGuardDesk = role === "guard" && page.id === "release-desk";
                    const locked = !page.grantable || fixedOn || fixedGuardDesk;
                    const on = fixedOn || draft[role].includes(page.id);
                    return (
                      <td key={role} className="px-4 py-3 text-center">
                        {locked ? (
                          <span className={`inline-flex size-8 items-center justify-center rounded-full ${on || fixedGuardDesk ? "bg-tide-50 text-tide-700 dark:bg-tide-500/15 dark:text-tide-300" : "bg-frost-100 text-ink-muted"}`} title={on || fixedGuardDesk ? tr("Always allowed") : tr("Cannot be granted")} aria-label={on || fixedGuardDesk ? tr("Always allowed") : tr("Cannot be granted")}>
                            {on || fixedGuardDesk ? <Check size={16} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
                          </span>
                        ) : (
                          <span className="inline-flex justify-center"><Toggle on={on} onChange={(value) => toggle(role, page.id, value)} label={tr("{0} can open {1}", { "0": tr(ROLE_INFO[role].label), "1": tr(page.label) })} /></span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="px-1 text-[12.5px] leading-5 text-ink-muted">{tr("A guard given any page besides the Release desk gets the full console with only those pages. Guards always keep the Release desk.")}</p>
    </section>
  );
}
