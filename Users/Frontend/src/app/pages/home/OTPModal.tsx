import { useState, useRef, useEffect } from "react";
import { X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface OTPModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
  onSubmit: (otp: string) => Promise<void>;
  email: string;
  title: string;
  description: string;
  isLoading?: boolean;
  error?: string;
  backLabel?: string;
}

export default function OTPModal({
  isOpen,
  onClose,
  onBack,
  onSubmit,
  email,
  title,
  description,
  isLoading = false,
  error = "",
  backLabel = "Back",
}: OTPModalProps) {
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutes in seconds
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Timer for OTP expiration
  useEffect(() => {
    if (!isOpen) return;
    
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, ""); // Only digits
    if (value.length <= 6) {
      setOtp(value);
      setOtpError("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (otp.length !== 6) {
      setOtpError("Please enter a 6-digit code");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(otp);
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setOtp("");
        setTimeLeft(600);
      }, 2000);
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/15 backdrop-blur-[2px] px-4">
      <div className="bg-white rounded-[20px] border border-line max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line p-6">
          <div>
            <h2 className="text-[20px] font-semibold text-navy-800">{title}</h2>
            <p className="mt-1 text-[13px] text-ink-soft leading-5">{description}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6 p-6">
          {/* Email Display */}
          <div className="rounded-[12px] border border-[#dbe3f0] bg-slate-50 p-3">
            <p className="text-[13px] text-ink-soft">
              <span className="font-semibold text-navy-800">Sent to:</span> {email}
            </p>
          </div>

          {/* Success State */}
          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex gap-3">
              <CheckCircle2 className="text-green-600 shrink-0" size={20} />
              <div>
                <p className="font-semibold text-green-900">Verified!</p>
                <p className="text-sm text-green-700">
                  Your account has been verified successfully.
                </p>
              </div>
            </div>
          )}

          {/* Error Display */}
          {(error || otpError) && !success && (
            <div className="bg-red-50 border border-rose-200 rounded-lg p-4 flex gap-3">
              <AlertCircle className="text-red-600 shrink-0" size={20} />
              <div>
                <p className="font-semibold text-red-900">Error</p>
                <p className="text-sm text-rose-800">{error || otpError}</p>
              </div>
            </div>
          )}

          {/* OTP Input Form */}
          {!success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-[13px] font-semibold text-ink">
                  Enter 6-Digit Code
                </label>
                <input
                  type="text"
                  value={otp}
                  onChange={handleOtpChange}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full rounded-[12px] border-2 border-[#dfe7f1] bg-slate-50 px-4 py-3 text-center text-[28px] font-bold tracking-[0.45em] text-ink outline-none transition-colors focus:border-navy-600 focus:ring-4 focus:ring-navy-600/10 disabled:cursor-not-allowed"
                  disabled={isSubmitting}
                />
                <p className="mt-2 text-[12px] text-ink-muted">
                  Check your email for the verification code
                </p>
              </div>

              {/* Timer */}
              <div className="flex items-center justify-between rounded-[10px] border border-line bg-slate-50 px-3 py-2">
                <span className="text-[12px] text-ink-soft">
                  Code expires in:
                </span>
                <span
                  className={`text-[13px] font-bold ${
                    timeLeft < 60 ? "text-red-600" : "text-navy-800"
                  }`}
                >
                  {formatTime(timeLeft)}
                </span>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting || otp.length !== 6 || timeLeft === 0}
                className="flex w-full items-center justify-center gap-2 rounded-[12px] bg-navy-800 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#162448] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify Code"
                )}
              </button>
            </form>
          )}

          {/* Resend Link */}
          {!success && (
            <div className="space-y-3 text-center">
              <p className="text-[13px] text-ink-soft">
                Didn't receive the code?{" "}
                <button type="button" className="font-semibold text-navy-800 transition-colors hover:text-[#d1a153]">
                  Resend
                </button>
              </p>
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="text-[13px] font-semibold text-navy-800 transition-colors hover:text-[#d1a153]"
                >
                  ← {backLabel}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
