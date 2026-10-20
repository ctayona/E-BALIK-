import { useCallback, useEffect, useState } from "react";
import { CalendarClock, LogOut, Plus, Trash2, Users } from "lucide-react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { BTN, INPUT } from "../../components/ui/primitives";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import { formatDateTime } from "../../utils/countdown";
import { cancelWindow, fetchWindows, fetchWipeState, scheduleWindow, wipeSessions, type MaintenanceWindow, type WindowList, type WipeRole, type WipeState } from "../../utils/opsApi";
import { tr } from "../../utils/preferences";
import { Card, ErrorNote } from "./parts";

/** `datetime-local` value for a Date, in the browser's own time zone. */
const local = (moment: Date) => new Date(moment.getTime() - moment.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function windowState(window: MaintenanceWindow): "running" | "upcoming" | "done" {
  const now = Date.now();
  if (Date.parse(window.end) <= now) return "done";
  return Date.parse(window.start) <= now ? "running" : "upcoming";
}

/** Maintenance windows: lock the app on a schedule, with a notice 48 hours before. The manual switch above still works on its own. */
export function MaintenanceSchedule() {
  const [data, setData] = useState<WindowList | null>(null);
  const [error, setError] = useState("");
  const [start, setStart] = useState(() => local(new Date(Date.now() + 24 * 3_600_000)));
  const [end, setEnd] = useState(() => local(new Date(Date.now() + 26 * 3_600_000)));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<MaintenanceWindow | null>(null);

  const load = useCallback(async () => {
    try { setData(await fetchWindows()); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to load the maintenance windows.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const first = new Date(start);
  const last = new Date(end);
  const validTimes = !Number.isNaN(first.getTime()) && !Number.isNaN(last.getTime()) && last > first && first.getTime() > Date.now() - 300_000 && last.getTime() - first.getTime() <= (data?.max_hours ?? 72) * 3_600_000;

  const add = async () => {
    if (!validTimes || busy) return;
    setBusy(true);
    try {
      await scheduleWindow(first, last, message.trim());
      setMessage("");
      await load();
    } catch { /* the API helper already showed the reason */ } finally {
      setBusy(false);
    }
  };

  const visible = (data?.windows ?? []).filter((window) => windowState(window) !== "done");

  return (
    <Card icon={<CalendarClock size={21} />} tone="gold" title={tr("Scheduled maintenance")}
      description={tr("Plan downtime ahead. The app locks for standard users by itself, staff keep working, and everyone sees a notice 48 hours before.")}
      aside={data?.locked_now ? <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[12.5px] font-bold text-white">{tr("Locked now")}</span> : undefined}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <SkeletonBlock className="h-40 w-full rounded-2xl" />}
      {data && (
        <div className="space-y-4">
          {visible.length > 0 ? (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-[var(--surface)]">
              {visible.map((window) => (
                <li key={window.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`size-2.5 shrink-0 rounded-full ${windowState(window) === "running" ? "bg-rose-500" : "bg-gold-500"}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold text-ink">{formatDateTime(window.start)} → {formatDateTime(window.end)}</p>
                    <p className="truncate text-[12.5px] text-ink-muted">{windowState(window) === "running" ? tr("Running now") : tr("Upcoming")}{window.message ? ` · ${window.message}` : ""}</p>
                  </div>
                  <button type="button" onClick={() => setRemoving(window)} className={`${BTN.ghost} !min-h-[36px] text-rose-700 dark:text-rose-300`} aria-label={tr("Cancel this window")}><Trash2 size={15} aria-hidden="true" />{tr("Cancel")}</button>
                </li>
              ))}
            </ul>
          ) : <p className="rounded-2xl border border-dashed border-line-strong px-4 py-4 text-center text-[13.5px] text-ink-muted">{tr("No maintenance is scheduled.")}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Starts")}</span><input type="datetime-local" value={start} min={local(new Date())} onChange={(event) => setStart(event.target.value)} className={INPUT} /></label>
            <label className="block"><span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Ends")}</span><input type="datetime-local" value={end} min={start} onChange={(event) => setEnd(event.target.value)} className={INPUT} /></label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold text-ink-soft">{tr("Message (optional)")}</span>
            <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={280} placeholder={tr("We are upgrading the database. Back by 11 PM.")} className={INPUT} />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={`text-[12.5px] ${validTimes || !start || !end ? "text-ink-muted" : "text-rose-600"}`}>{validTimes || !start || !end ? tr("Times use your device's clock. At most {0} hours.", { "0": data.max_hours }) : tr("Choose a start from now on, and an end after it (at most {0} hours).", { "0": data.max_hours })}</p>
            <button type="button" onClick={() => void add()} disabled={!validTimes || busy} className={BTN.gold}><Plus size={16} aria-hidden="true" />{busy ? tr("Scheduling…") : tr("Schedule")}</button>
          </div>
        </div>
      )}

      {removing && (
        <ConfirmActionDialog
          title={tr("cancel the maintenance on {0}?", { "0": formatDateTime(removing.start) })}
          description="The window is removed and the notice disappears. If it is running now, the app opens again straight away."
          confirmLabel="Cancel window"
          busy={busy}
          onCancel={() => { if (!busy) setRemoving(null); }}
          onConfirm={() => { setBusy(true); void cancelWindow(removing.id).then(() => load()).catch(() => undefined).finally(() => { setBusy(false); setRemoving(null); }); }}
        />
      )}
    </Card>
  );
}

const ROLE_COPY: Record<WipeRole, { label: string; hint: string }> = {
  user: { label: "Standard users", hint: "Everyone with a normal account" },
  guard: { label: "Guards", hint: "Release desk staff" },
  admin: { label: "Administrators", hint: "Office staff (not super admins)" },
};

/** Role-based session wipe: end every current session of the chosen roles. Super administrators are never signed out, so this cannot lock you out. */
export function RoleSessionWipe() {
  const [state, setState] = useState<WipeState | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<WipeRole[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setState(await fetchWipeState()); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : tr("Unable to load the session wipes.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = (role: WipeRole) => setPicked((current) => (current.includes(role) ? current.filter((value) => value !== role) : [...current, role]));
  const people = picked.reduce((sum, role) => sum + (state?.counts[role] ?? 0), 0);

  return (
    <Card icon={<Users size={21} />} tone="danger" title={tr("Sign out by role")}
      description={tr("End every current session for the roles you choose, and leave the others alone. Super administrators are never signed out.")}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!state && !error && <SkeletonBlock className="h-40 w-full rounded-2xl" />}
      {state && (
        <div className="flex h-full flex-col">
          <ul className="space-y-2">
            {(Object.keys(ROLE_COPY) as WipeRole[]).map((role) => {
              const on = picked.includes(role);
              const last = state.wipes[role];
              return (
                <li key={role}>
                  <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(role)} className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors ${on ? "border-rose-300 bg-rose-50/70 dark:border-rose-500/40 dark:bg-rose-500/10" : "border-line bg-frost-50 hover:border-line-strong"}`}>
                    <span className={`flex size-6 shrink-0 items-center justify-center rounded-md border-2 ${on ? "border-rose-600 bg-rose-600 text-white" : "border-line-strong"}`} aria-hidden="true">{on && <LogOut size={13} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold text-ink">{tr(ROLE_COPY[role].label)}</span>
                      <span className="block text-[12.5px] text-ink-muted">{tr(ROLE_COPY[role].hint)}{last ? ` · ${tr("Last signed out {0}", { "0": formatDateTime(last.ts) })}` : ""}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[12.5px] font-semibold tabular-nums text-ink-soft ring-1 ring-line dark:bg-white/10">{tr("{0} accounts", { "0": state.counts[role] })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-auto pt-5">
            <button type="button" disabled={!picked.length || busy} onClick={() => setConfirming(true)} className={BTN.danger}><LogOut size={16} aria-hidden="true" />{picked.length ? tr("Sign out {0} accounts", { "0": people }) : tr("Choose a role")}</button>
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmActionDialog
          title={tr("sign out {0} accounts?", { "0": people })}
          description={`${picked.map((role) => ROLE_COPY[role].label).join(", ")} are signed out on their next request and must sign in again. Super administrators are not affected.`}
          confirmLabel="Sign them out"
          danger
          busy={busy}
          onCancel={() => { if (!busy) setConfirming(false); }}
          onConfirm={() => { setBusy(true); void wipeSessions(picked).then(() => { setPicked([]); return load(); }).catch(() => undefined).finally(() => { setBusy(false); setConfirming(false); }); }}
        />
      )}
    </Card>
  );
}
