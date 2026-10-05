import { useEffect, useRef, useState } from "react";
import { ArrowLeft, KeyRound, Mail, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/app/utils/useAuth";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import OTPModal from "@/app/pages/home/OTPModal";
import { CX } from "@/app/utils/clay";

export default function ForgotPasswordModal({
  onClose,
  onBackToLogin,
}: {
  onClose: () => void;
  onBackToLogin: () => void;
}) {
  // All state & logic preserved exactly
  const [email,           setEmail]           = useState("");
  const [newPassword,     setNewPassword]     = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpCode,         setOtpCode]         = useState("");
  const [otpModalOpen,    setOtpModalOpen]    = useState(false);
  const [step,            setStep]            = useState<"request" | "otp" | "reset">("request");
  const [statusMessage,   setStatusMessage]   = useState("");
  const [errorMessage,    setErrorMessage]    = useState("");
  const { forgotPassword, resetPassword, isLoading, error, clearError } = useAuth();
  const stepRef = useRef(step);

  useEffect(() => { stepRef.current = step; }, [step]);

  const handleOtpModalClose = () => {
    setOtpModalOpen(false);
    if (stepRef.current !== "reset") setStep("request");
  };

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    clearError();
    const result = await forgotPassword(email);
    if (!result.success) { showInfoModal({ variant: "error", title: "Reset code not sent", message: result.error || "Unable to send reset code. Please try again." }); return; }
    showInfoModal({ variant: "info", title: "Check your email", message: `A verification code has been sent to ${email}. Enter it to set a new password.` });
    setStep("otp");
    setOtpModalOpen(true);
  }

  async function handleOtpSubmit(otp: string) {
    setOtpCode(otp);
    setStatusMessage("OTP verified. Please set your new password.");
    setStep("reset");
    setOtpModalOpen(false);
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    clearError();
    if (!newPassword || !confirmPassword) { setErrorMessage("Please enter and confirm your new password."); return; }
    if (newPassword.length < 16) { setErrorMessage("Password must be at least 16 characters."); return; }
    if (newPassword !== confirmPassword) { setErrorMessage("Passwords do not match."); return; }
    const result = await resetPassword(otpCode, newPassword);
    if (!result.success) { showInfoModal({ variant: "error", title: "Password not reset", message: result.error || "Unable to reset password." }); return; }
    showInfoModal({ variant: "success", title: "Password reset complete", message: "You can now sign in with your new password." });
    onBackToLogin();
    onClose();
  }

  return (
    <>
      {/* Clay modal card */}
      <div className={`relative flex flex-col items-start gap-5 w-full px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-9 sm:w-[460px] sm:p-8 rounded-t-[28px] sm:rounded-[26px] border border-white/70 bg-white shadow-overlay`}>

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex size-8 items-center justify-center rounded-full text-slate-500 hover:text-navy-800 hover:bg-slate-100 transition-colors"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="flex size-[54px] items-center justify-center rounded-[16px] border bg-navy-800 text-gold-300">
            <KeyRound size={24} />
          </div>
          <div>
            <p className="text-[12px] font-semibold text-gold-700">Recovery</p>
            <h2 className="text-[22px] font-semibold text-navy-800" style={{ fontFamily: "var(--font-heading)" }}>
              Forgot Password
            </h2>
          </div>
        </div>

        <div className={CX.divider} />

        {/* Status / error banners */}
        {statusMessage && <div className={CX.alertSuccess}>{statusMessage}</div>}
        {(errorMessage || error) && <div className={CX.alertError}>{errorMessage || error}</div>}

        {/* Step: request */}
        {step === "request" && (
          <form onSubmit={handleRequestReset} className="flex flex-col gap-4 w-full">
            <div className="flex flex-col gap-2">
              <label className="text-[12px] font-bold text-navy-800">UM Email Address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@umak.edu.ph"
                  required
                  className={`${CX.input} h-[50px] pl-10 w-full`}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className={`${CX.btnNavy} h-[52px] text-[15px] w-full`}
            >
              {isLoading ? "Sending code…" : "Send verification code"}
            </button>
          </form>
        )}

        {/* Step: reset */}
        {step === "reset" && (
          <form onSubmit={handleResetSubmit} className="flex flex-col gap-4 w-full">
            <div className="flex flex-col gap-2">
              <label className="text-[12px] font-bold text-navy-800">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 16 characters"
                required
                className={`${CX.input} h-[50px] w-full`}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[12px] font-bold text-navy-800">Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                className={`${CX.input} h-[50px] w-full`}
              />
            </div>

            {/* Security reminder — clay info box */}
            <div className={`${CX.alertInfo} flex gap-3 items-start`}>
              <ShieldCheck size={16} className="text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-blue-800 text-[12px] mb-0.5">Security reminder</p>
                <p>Use at least 16 characters with uppercase, lowercase, a number, and a special character.</p>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`${CX.btnNavy} h-[52px] text-[15px] w-full`}
            >
              {isLoading ? "Resetting password…" : "Reset password"}
            </button>
          </form>
        )}

        {/* Back link */}
        <button
          type="button"
          onClick={() => {
            if (step === "otp")   { setStep("request"); setOtpModalOpen(false); return; }
            if (step === "reset") { setStep("otp"); setOtpModalOpen(true); return; }
            onBackToLogin();
          }}
          className="flex items-center gap-2 text-[13px] font-bold text-navy-800 hover:text-[#d1a153] transition-colors"
        >
          <ArrowLeft size={14} />
          {step === "request" ? "Back to Login" : "Back"}
        </button>
      </div>

      {/* OTP modal unchanged */}
      {otpModalOpen && (
        <OTPModal
          isOpen={true}
          onClose={handleOtpModalClose}
          onBack={() => { setOtpModalOpen(false); setStep("request"); setStatusMessage("You can request a new verification code anytime."); }}
          onSubmit={handleOtpSubmit}
          email={email}
          title="Reset your password"
          description="Enter the 6-digit code sent to your email to continue resetting your password."
          isLoading={isLoading}
          error={error || errorMessage}
          backLabel="Back to recovery"
        />
      )}
    </>
  );
}
