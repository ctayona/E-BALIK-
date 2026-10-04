import { useEffect, useMemo, useState } from "react";
import { getStoredAdmin, fetchAdminMfaStatus, beginAdminMfaSetup, verifyAdminMfaSetup, disableAdminMfa } from "../../utils/api";
import { ShieldCheck, Smartphone, KeyRound } from "lucide-react";
import { SkeletonBlock } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";

export default function AdminProfile() {
  const user = useMemo(() => getStoredAdmin(), []);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [setup, setSetup] = useState<{ qr_data_url: string; manual_setup_key: string; expires_at: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [setupPassword, setSetupPassword] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaNotice, setMfaNotice] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [pendingMfaAction, setPendingMfaAction] = useState<"setup" | "verify" | "disable" | null>(null);

  useEffect(() => {
    let active = true;
    fetchAdminMfaStatus()
      .then((status) => { if (active) setMfaEnabled(status.enabled); })
      .catch((error) => { if (active) setMfaError(error instanceof Error ? error.message : "Unable to load authenticator status."); })
      .finally(() => { if (active) setMfaLoading(false); });
    return () => { active = false; };
  }, []);

  if (!user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6 text-center">
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
          <p className="text-lg font-semibold text-slate-900">No valid admin profile was found.</p>
          <p className="mt-2 text-sm text-slate-600">Please sign in again to continue.</p>
        </div>
      </div>
    );
  }

  const initials = `${user.fname?.[0] ?? "A"}${user.lname?.[0] ?? "D"}`.toUpperCase();

  async function startMfaSetup() {
    setMfaBusy(true); setMfaError(""); setMfaNotice("");
    try {
      setSetup(await beginAdminMfaSetup(setupPassword));
      setSetupPassword("");
    } catch (error) {
      setMfaError(error instanceof Error ? error.message : "Unable to start authenticator setup.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function confirmMfaSetup() {
    setMfaBusy(true); setMfaError(""); setMfaNotice("");
    try {
      const result = await verifyAdminMfaSetup(verificationCode);
      setMfaEnabled(true);
      setRecoveryCodes(result.recovery_codes || []);
      setSetup(null);
      setVerificationCode("");
      setMfaNotice("Authenticator enabled. Save your recovery codes before leaving this page.");
    } catch (error) {
      setMfaError(error instanceof Error ? error.message : "Unable to verify authenticator setup.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function turnOffMfa() {
    setMfaBusy(true); setMfaError(""); setMfaNotice("");
    try {
      await disableAdminMfa(disablePassword, disableCode);
      setMfaEnabled(false);
      setDisablePassword(""); setDisableCode("");
      setMfaNotice("Authenticator MFA has been disabled.");
    } catch (error) {
      setMfaError(error instanceof Error ? error.message : "Unable to disable authenticator MFA.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function runPendingMfaAction() {
    if (pendingMfaAction === "setup") await startMfaSetup();
    else if (pendingMfaAction === "verify") await confirmMfaSetup();
    else if (pendingMfaAction === "disable") await turnOffMfa();
    setPendingMfaAction(null);
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-4xl rounded-2xl border border-line bg-white shadow-sm">
        <div className="border-b border-line p-6">
          <div className="flex items-center gap-5">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-navy-800 text-2xl font-bold text-white">
              {initials}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">{user.fname} {user.lname}</h1>
              <p className="text-sm text-slate-500">{user.user_role || "Administrator"}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-slate-50 p-4">
            <h2 className="mb-4 text-lg font-semibold text-slate-800">Profile Information</h2>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex justify-between gap-4"><span className="text-slate-500">Full Name</span><span className="font-medium">{user.fname} {user.lname}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">Email</span><span className="font-medium break-all">{user.email}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">Campus ID</span><span className="font-medium">{user.campus_id || "N/A"}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">Role</span><span className="font-medium">{user.user_role || "Admin"}</span></div>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-slate-50 p-4">
            <h2 className="mb-4 text-lg font-semibold text-slate-800">Account Status</h2>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Status</span>
                <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Active</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Access Level</span>
                <span className="font-medium">{user.access_level === "super_admin" ? "Full Superadmin Access" : "Admin Access"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Last Login</span>
                <span className="font-medium">Just now</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="mx-auto mt-6 max-w-4xl rounded-2xl border border-line bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3 border-b border-line pb-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tide-50 text-tide-700"><ShieldCheck size={21} /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Admin two-factor authentication</h2>
            <p className="mt-1 text-sm leading-5 text-slate-500">Use Google Authenticator or another TOTP-compatible app to protect your Admin account.</p>
          </div>
        </div>

        {mfaError && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{mfaError}</div>}
        {mfaNotice && <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{mfaNotice}</div>}

        {mfaLoading ? (
          <div className="mt-5 space-y-3" aria-label="Loading security settings" aria-busy="true"><SkeletonBlock className="h-5 w-52" /><SkeletonBlock className="h-24 w-full" /></div>
        ) : recoveryCodes.length > 0 ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center gap-2 font-semibold text-amber-900"><KeyRound size={17} /> Save these one-time recovery codes</div>
            <p className="mt-1 text-xs leading-5 text-amber-800">Each code works once if you lose access to your authenticator. They will not be shown again.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {recoveryCodes.map((code) => <code key={code} className="rounded-md border border-amber-200 bg-white px-2 py-2 text-center text-xs font-bold text-slate-800">{code}</code>)}
            </div>
            <button type="button" onClick={() => { setRecoveryCodes([]); setMfaNotice("Recovery codes hidden. Store them somewhere private and separate from your phone."); }} className="mt-4 rounded-lg bg-navy-800 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-700">I saved these codes</button>
          </div>
        ) : mfaEnabled ? (
          <div className="mt-5 grid gap-5 md:grid-cols-[1fr_1fr]">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-center gap-2 font-semibold text-emerald-800"><ShieldCheck size={17} /> Authenticator is enabled</div>
              <p className="mt-2 text-sm leading-5 text-emerald-800">A six-digit authenticator code is required at each new Admin sign-in.</p>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); setPendingMfaAction("disable"); }} className="space-y-3 rounded-xl border border-line p-5">
              <h3 className="font-semibold text-slate-800">Disable authenticator</h3>
              <input type="password" autoComplete="current-password" required value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} placeholder="Current account password" className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" />
              <input inputMode="numeric" autoComplete="one-time-code" required value={disableCode} onChange={(event) => setDisableCode(event.target.value)} placeholder="Current 6-digit code" className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" />
              <button disabled={mfaBusy} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">{mfaBusy ? "Working…" : "Disable MFA"}</button>
            </form>
          </div>
        ) : setup ? (
          <div className="mt-5 grid gap-5 md:grid-cols-[220px_1fr]">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-slate-50 p-4">
              <img src={setup.qr_data_url} alt="Authenticator enrollment QR code" className="size-48 rounded-lg bg-white p-2" />
              <div className="flex items-center gap-1 text-xs text-slate-500"><Smartphone size={14} /> Scan with Google Authenticator</div>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); setPendingMfaAction("verify"); }} className="space-y-3">
              <label className="block text-sm font-semibold text-slate-800">Can’t scan? Enter this setup key manually.</label>
              <code className="block break-all rounded-lg border border-line bg-slate-50 p-3 text-sm font-bold tracking-wider text-slate-800">{setup.manual_setup_key}</code>
              <p className="text-xs text-slate-500">This setup expires at {new Date(setup.expires_at).toLocaleTimeString()}.</p>
              <label className="block text-sm font-semibold text-slate-800" htmlFor="admin-mfa-confirm-code">Enter the code shown in your app</label>
              <input id="admin-mfa-confirm-code" inputMode="numeric" autoComplete="one-time-code" required value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} placeholder="000000" className="w-full max-w-xs rounded-lg border border-line px-3 py-2 text-sm tracking-[0.2em] focus:outline-none focus:ring-2 focus:ring-navy-600/20" />
              <div><button disabled={mfaBusy} className="rounded-lg bg-tide-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tide-700 disabled:opacity-50">{mfaBusy ? "Verifying…" : "Verify and enable"}</button></div>
            </form>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); setPendingMfaAction("setup"); }} className="mt-5 max-w-xl space-y-3">
            <p className="text-sm leading-5 text-slate-600">Enrollment requires your password and a code from the authenticator app before MFA is activated. You will receive one-time recovery codes after setup.</p>
            <label htmlFor="admin-mfa-password" className="block text-sm font-semibold text-slate-800">Confirm your password</label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input id="admin-mfa-password" type="password" autoComplete="current-password" required value={setupPassword} onChange={(event) => setSetupPassword(event.target.value)} placeholder="Current account password" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600/20" />
              <button disabled={mfaBusy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-navy-800 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-50"><ShieldCheck size={16} />{mfaBusy ? "Preparing…" : "Enable Google Authenticator"}</button>
            </div>
          </form>
        )}
      </section>
      {pendingMfaAction && <ConfirmActionDialog
        title={pendingMfaAction === "disable" ? "disable authenticator MFA" : pendingMfaAction === "verify" ? "enable authenticator MFA" : "begin authenticator enrollment"}
        description="This changes the security settings for your admin account."
        confirmLabel={pendingMfaAction === "disable" ? "Disable MFA" : "Continue"}
        danger={pendingMfaAction === "disable"}
        busy={mfaBusy}
        onCancel={() => setPendingMfaAction(null)}
        onConfirm={() => void runPendingMfaAction()}
      />}
    </div>
  );
}
