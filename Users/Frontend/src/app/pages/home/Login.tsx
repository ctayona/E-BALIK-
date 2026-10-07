import { useEffect, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import umakLogo from "@/imports/umaklogo.webp";
import { useAuth } from "@/app/utils/useAuth";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";

// Clay design tokens (matching Landing)
const clay = {
  input:  "rounded-xl border border-line-strong bg-[#f8f9fc] h-[48px] px-4 text-[14px] outline-none transition-colors w-full  focus:border-navy-600 focus:bg-white  placeholder:text-slate-500",
  btn:    "rounded-xl border bg-navy-800 hover:bg-navy-700 text-white font-bold    transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed",
};

export default function Login({
  onClose,
  onSwitchToRegister = () => undefined,
  onForgotPassword = () => undefined,
  onLoginSuccess,
  staffOnly = false,
}: {
  onClose: () => void;
  onSwitchToRegister?: () => void;
  onForgotPassword?: () => void;
  onLoginSuccess: () => void;
  /** Maintenance screen: only admins can sign in, so hide registration and password recovery. */
  staffOnly?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const [googleRegisterPrompt, setGoogleRegisterPrompt] = useState<{ open: boolean; email: string } | null>(null);
  const [mfaChallengeToken, setMfaChallengeToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const { login, googleLogin, verifyAdminMfa, isLoading, error, clearError } = useAuth();

  function redirectAdmin(user: { user_role?: string; access_level?: string }) {
    if (["admin", "super_admin", "guard"].includes((user.access_level || user.user_role || "").toLowerCase())) {
      const adminUrl = import.meta.env.VITE_ADMIN_URL || "/admin/";
      const token = localStorage.getItem("ebalik_token");
      const storedUser = localStorage.getItem("ebalik_user");
      if (token && storedUser) {
        localStorage.setItem("ebalik_admin_token", token);
        localStorage.setItem("ebalik_admin_user", storedUser);
      }
      window.location.assign(adminUrl);
      return true;
    }
    return false;
  }

  useEffect(() => {
    const scriptId = "google-gsi-script";
    const existingScript = document.getElementById(scriptId);
    if (existingScript) {
      if (window.google && window.google.accounts) setGoogleReady(true);
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleReady(true);
    script.onerror = () => showInfoModal({ variant: "warning", title: "Google sign-in unavailable", message: "The Google sign-in script failed to load. You can still sign in with your email and password." });
    document.body.appendChild(script);
    return () => { const c = document.getElementById(scriptId); if (c) c.remove(); };
  }, []);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || !googleReady || !window.google || !window.google.accounts) return;
    const buttonElement = document.getElementById("google-signin-button");
    if (!buttonElement) return;
    buttonElement.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) { showInfoModal({ variant: "info", title: "Google sign-in cancelled", message: "No changes were made. Choose a Google account to continue, or sign in with your email." }); return; }
        const result = await googleLogin(response.credential, "login");
        if ("mfaRequired" in result && result.mfaRequired && result.challengeToken) {
          setMfaChallengeToken(result.challengeToken);
          setMfaCode("");
          setSubmitError("");
          return;
        }
        if (!result.success) {
          const message = result.error || "Google sign-in failed.";
          if (result.code === "REGISTER_REQUIRED") {
            const emailToUse = result.google_profile?.email || "your email";
            setGoogleRegisterPrompt({ open: true, email: emailToUse });
            setSubmitError("");
            return;
          }
          if (result.code === "EMAIL_ALREADY_REGISTERED") {
            showInfoModal({ variant: "warning", title: "Use your email and password", message: "This email is already registered. Please log in with your email and password instead." });
            return;
          }
          showInfoModal({ variant: "error", title: "Google sign-in failed", message });
          return;
        }
        if (result.user && redirectAdmin(result.user)) return;
        showInfoModal({ variant: "success", title: "Signed in", message: `Welcome back${result.user?.fname ? `, ${result.user.fname}` : ""}. Your dashboard is ready.` });
        onClose();
        onLoginSuccess();
      },
    });
    window.google.accounts.id.renderButton(buttonElement, {
      theme: "outline", size: "large", text: "continue_with", shape: "pill", logo_alignment: "left",
    });
  }, [googleReady, googleLogin, onClose, onLoginSuccess]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    setSuccessMessage("");
    clearError();
    const result = await login(email, password);
    if ("mfaRequired" in result && result.mfaRequired && result.challengeToken) {
      setMfaChallengeToken(result.challengeToken);
      setMfaCode("");
      setSubmitError("");
      return;
    }
    if (!result.success) { showInfoModal({ variant: "error", title: "Sign-in failed", message: result.error || "Login failed. Please try again." }); return; }
    if (result.user && redirectAdmin(result.user)) return;
    showInfoModal({ variant: "success", title: "Signed in", message: `Welcome back${result.user?.fname ? `, ${result.user.fname}` : ""}. Your dashboard is ready.` });
    onClose();
    onLoginSuccess();
  }

  async function handleMfaSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError("");
    clearError();
    const result = await verifyAdminMfa(mfaChallengeToken, mfaCode);
    if (!result.success) {
      setSubmitError(result.error || "Authenticator verification failed.");
      return;
    }
    if (result.user && redirectAdmin(result.user)) return;
    showInfoModal({ variant: "success", title: "Signed in", message: "Authenticator verified. Your dashboard is ready." });
    setMfaChallengeToken("");
    onClose();
    onLoginSuccess();
  }

  return (
    /* ── Clay login card ── */
    <div
      className="relative flex w-full flex-col items-start gap-6 overflow-hidden px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-9 sm:w-[440px] sm:p-10 rounded-t-[28px] sm:rounded-[26px] border border-white/70 bg-white shadow-overlay before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-32 before:bg-[radial-gradient(60%_100%_at_15%_0%,rgba(110,142,240,0.16),transparent),radial-gradient(50%_100%_at_100%_0%,rgba(209,161,83,0.16),transparent)]"
    >
      {mfaChallengeToken && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-navy-950/60 backdrop-blur-md sm:items-center sm:px-4" role="presentation">
          <form onSubmit={handleMfaSubmit} role="dialog" aria-modal="true" aria-labelledby="admin-mfa-title" className="w-full p-7 pb-[max(1.75rem,env(safe-area-inset-bottom))] sm:max-w-md rounded-t-[28px] sm:rounded-[26px] border border-white/70 bg-white shadow-overlay">
            <p className="text-[12px] font-semibold text-gold-700">Administrator verification</p>
            <h2 id="admin-mfa-title" className="mt-2 text-[22px] font-semibold text-navy-800" style={{ fontFamily: "var(--font-heading)" }}>Enter your authenticator code</h2>
            <p className="mt-2 text-[13px] leading-5 text-ink-muted">Use the current six-digit code from Google Authenticator, or enter one unused recovery code.</p>
            <input autoFocus value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" placeholder="000000" required className={`${clay.input} mt-5 h-[50px] w-full text-center text-[20px] font-bold tracking-[0.2em]`} />
            {(submitError || error) && <p role="alert" className="mt-3 rounded-[10px] bg-red-50 px-3 py-2 text-[12px] text-rose-800">{submitError || error}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => { setMfaChallengeToken(""); setMfaCode(""); setSubmitError(""); }} className="rounded-[12px] border border-[#dbe3f0] px-4 py-2 text-[13px] font-semibold text-ink-soft">Cancel</button>
              <button type="submit" disabled={isLoading || !mfaCode.trim()} className={`${clay.btn} px-5 py-2 text-[13px] disabled:opacity-60`}>{isLoading ? "Verifying…" : "Verify and Continue"}</button>
            </div>
          </form>
        </div>
      )}
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 text-slate-500 hover:text-navy-800 transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100"
      >
        <X size={18} />
      </button>

      {/* UMak branding — clay chip */}
      <div className="flex items-center gap-3 w-full">
        <div className="flex items-center justify-center rounded-xl size-[52px] border border-[#e8edf5] bg-white">
          <img decoding="async" alt="University of Makati" className="size-[38px] object-contain" src={umakLogo} />
        </div>
        <div>
          <p className="font-semibold text-navy-800 text-[13px] leading-tight" style={{ fontFamily: "var(--font-heading)" }}>
            UNIVERSITY OF MAKATI
          </p>
          <p className="font-bold text-[#d1a153] text-[12px] leading-tight tracking-wide">E-BALIK SYSTEM</p>
        </div>
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-line" />

      <div>
        <p className="font-semibold text-navy-800 text-[24px]" style={{ fontFamily: "var(--font-heading)" }}>
          Log In to E-Balik
        </p>
        <p className="text-ink-muted text-[14px] mt-1">Access your University of Makati account</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
        {/* Email */}
        <div className="flex flex-col gap-2">
          <label className="font-bold text-navy-800 text-[13px]">UMak email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. j.santos@umak.edu.ph"
            required
            className={clay.input}
          />
        </div>

        {/* Password */}
        <div className="flex flex-col gap-2">
          <label className="font-bold text-navy-800 text-[13px]">Password</label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className={`${clay.input} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-ink-soft transition-colors"
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Forgot password */}
        {!staffOnly && (
          <button
            type="button"
            onClick={onForgotPassword}
            className="font-semibold text-navy-800 text-[13px] underline hover:text-[#d1a153] transition-colors self-start"
          >
            Forgot Password?
          </button>
        )}

        {/* Error */}
        {(submitError || error) && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800 text-[13px]">
            {submitError || error}
          </div>
        )}

        {/* Success */}
        {successMessage && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 text-[13px]">
            {successMessage}
          </div>
        )}

        {/* Submit — clay button */}
        <button
          type="submit"
          disabled={isLoading}
          className={`${clay.btn} h-[52px] text-[15px] w-full  `}
        >
          {isLoading ? "Logging in…" : "Log in"}
        </button>
      </form>

      {/* Divider */}
      <div className="flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[#e2e8f0]" />
        <span className="text-[12px] font-bold text-slate-500">or</span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[#e2e8f0]" />
      </div>

      {/* Google sign-in */}
      <div className="w-full">
        <div id="google-signin-button" className="w-full" />
      </div>

      {!staffOnly && (
        <>
          <div className="w-full h-px bg-line" />

          {/* Switch to register */}
          <div className="flex gap-1 items-center justify-center w-full">
            <span className="text-ink-muted text-[14px]">Don&apos;t have an account?</span>
            <button
              onClick={onSwitchToRegister}
              className="font-bold text-navy-800 text-[14px] underline hover:text-[#d1a153] transition-colors"
            >
              Register
            </button>
          </div>
        </>
      )}

      {/* Google register prompt — nested clay dialog */}
      {googleRegisterPrompt?.open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-950/60 backdrop-blur-md sm:items-center sm:px-4" role="presentation">
          <div role="dialog" aria-modal="true" className="w-full p-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:max-w-md rounded-t-[28px] sm:rounded-[26px] border border-white/70 bg-white shadow-overlay">
            <p className="text-[12px] font-semibold text-gold-700">Account needed</p>
            <h3 className="mt-2 text-[22px] font-semibold text-navy-800" style={{ fontFamily: "var(--font-heading)" }}>
              Sign in first
            </h3>
            <p className="mt-2 text-[14px] text-ink-soft">
              We couldn&apos;t find an account for{" "}
              <span className="font-bold text-navy-800">{googleRegisterPrompt.email}</span>.
              Please sign in with your existing UMak account first, or create a new one.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setGoogleRegisterPrompt(null)}
                className="rounded-[12px] border border-line-strong bg-white px-5 py-2.5 text-[13px] font-bold text-navy-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setGoogleRegisterPrompt(null); onSwitchToRegister(); }}
                className="rounded-[12px] border bg-navy-800 hover:bg-navy-700 px-5 py-2.5 text-[13px] font-bold text-white transition-colors"
              >
                Register Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
