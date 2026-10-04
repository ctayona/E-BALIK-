import { useEffect, useState } from "react";
import { Eye, EyeOff, X, CheckCircle2, XCircle, ShieldCheck, Sparkles } from "lucide-react";
import umakLogo from "@/imports/umaklogo.png";
import OTPModal from "@/app/pages/home/OTPModal";
import { useAuth } from "@/app/utils/useAuth";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";

function inferAccountProfile(email: string, campusId?: string) {
  const normalized = (email || "").trim().toLowerCase();
  const existingCampus = (campusId || "").trim();

  const studentMatch = normalized.match(/^.+\.(k\d+|a\d+)@umak\.edu\.ph$/i);
  if (studentMatch) {
    const value = studentMatch[1];
    const campusValue = value ? `${value[0].toUpperCase()}${value.slice(1)}` : existingCampus;
    return {
      role: "Student" as const,
      campusId: campusValue || existingCampus,
      domainValid: true,
    };
  }

  if (normalized.endsWith("@umak.edu.ph")) {
    return {
      role: "Faculty" as const,
      campusId: existingCampus,
      domainValid: true,
    };
  }

  const gmailMatch = normalized.endsWith("@gmail.com");
  return {
    role: "Others" as const,
    campusId: existingCampus,
    domainValid: gmailMatch || normalized.endsWith("@umak.edu.ph"),
  };
}

function checkPassword(pw: string) {
  return {
    length: pw.length >= 16,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}

const clayInput = "rounded-xl border border-line-strong bg-slate-50 h-[48px] px-4 text-[14px] outline-none transition-colors w-full  focus:border-navy-600 ";
const clayInputError = "rounded-xl border border-red-400 bg-rose-50 h-[48px] px-4 text-[14px] outline-none transition-colors w-full  ";

function PasswordRule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {ok
        ? <CheckCircle2 size={13} className="text-green-500 shrink-0" />
        : <XCircle size={13} className="text-slate-400 shrink-0" />}
      <span className={`text-[12px] ${ok ? "text-green-600" : "text-slate-400"}`}>{label}</span>
    </div>
  );
}

export default function Register({
  onClose,
  onSwitchToLogin,
  onRegisterSuccess,
}: {
  onClose: () => void;
  onSwitchToLogin: () => void;
  onRegisterSuccess: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [tried, setTried] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const { register, verifyOtp, googleLogin, isLoading, error, clearError } = useAuth();

  const pwChecks = checkPassword(password);
  const pwValid = Object.values(pwChecks).every(Boolean);
  const pwMatch = password === confirmPassword && confirmPassword.length > 0;

  useEffect(() => {
    const profile = inferAccountProfile(email, studentId);

    if (profile.role === "Student" && !studentId && profile.campusId) {
      setStudentId(profile.campusId);
    }
  }, [email, studentId]);

  useEffect(() => {
    const scriptId = "google-gsi-script";
    const existingScript = document.getElementById(scriptId);
    if (existingScript) {
      if (window.google && window.google.accounts) {
        setGoogleReady(true);
      }
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleReady(true);
    script.onerror = () => showInfoModal({ variant: "warning", title: "Google sign-in unavailable", message: "The Google sign-in script failed to load. You can still register with your UMak email." });
    document.body.appendChild(script);

    return () => {
      const current = document.getElementById(scriptId);
      if (current) current.remove();
    };
  }, []);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || !googleReady || !window.google || !window.google.accounts) return;

    const buttonElement = document.getElementById("register-google-signin-button");
    if (!buttonElement) return;

    buttonElement.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) {
          showInfoModal({ variant: "info", title: "Google registration cancelled", message: "No account was created. Choose a Google account to continue, or fill in the form." });
          return;
        }

        const result = await googleLogin(response.credential, 'register');
        if (!result.success) {
          if (result.code === 'REGISTER_REQUIRED') {
            const profile = result.google_profile;
            if (profile?.email) {
              setEmail(profile.email);
              setFirstName(profile.fname || "");
              setLastName(profile.lname || "");
              const inferred = inferAccountProfile(profile.email, profile.campus_id || "");
              if (inferred.role === "Student" && inferred.campusId) {
                setStudentId(inferred.campusId);
              }
              setSubmitError("");
              clearError();
              showInfoModal({ variant: "info", title: "Google profile loaded", message: "We filled in your details from Google. Set a password below to finish creating your account." });
              return;
            }
          }

          if (result.code === 'EMAIL_ALREADY_REGISTERED') {
            showInfoModal({ variant: "warning", title: "Account already exists", message: "This email is already registered. Please log in instead." });
            return;
          }

          showInfoModal({ variant: "error", title: "Google registration failed", message: result.error || "Google registration failed." });
          return;
        }

        const userInfo = result.user;
        if (userInfo?.email) {
          setEmail(userInfo.email);
          const nameParts = [userInfo.fname, userInfo.lname].filter(Boolean);
          if (nameParts.length > 0) {
            setFirstName(userInfo.fname || "");
            setLastName(userInfo.lname || "");
          }
          const profile = inferAccountProfile(userInfo.email, userInfo.campus_id || studentId);
          if (profile.role === "Student" && profile.campusId) {
            setStudentId(profile.campusId);
          }
        }

        showInfoModal({ variant: "success", title: "Google account linked", message: "Complete your password setup below to finish registration." });
      },
    });

    window.google.accounts.id.renderButton(buttonElement, {
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      logo_alignment: "left",
    });
  }, [googleReady, googleLogin, studentId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setSubmitError("");
    setSuccessMessage("");
    clearError();

    const normalizedEmail = email.trim().toLowerCase();
    const emailProfile = inferAccountProfile(normalizedEmail, studentId);
    const effectiveCampusId = (emailProfile.campusId || studentId.trim() || "").trim();

    if (!normalizedEmail.endsWith("@umak.edu.ph") && !normalizedEmail.endsWith("@gmail.com")) {
      setSubmitError("Use a valid UMak email or continue with Google.");
      return;
    }

    if (!pwValid || !pwMatch) return;

    const result = await register({
      fname: firstName,
      mname: middleName,
      lname: lastName,
      email: normalizedEmail,
      campus_id: effectiveCampusId,
      password,
    });

    if (!result.success) {
      showInfoModal({ variant: "error", title: "Registration failed", message: result.error || "Registration failed. Please try again." });
      return;
    }

    if (effectiveCampusId && !studentId.trim()) {
      setStudentId(effectiveCampusId);
    }

    showInfoModal({ variant: "info", title: "Check your email", message: `We sent a 6-digit verification code to ${normalizedEmail}. Enter it to finish creating your account.` });
    setShowOtpModal(true);
  }

  async function handleOtpSubmit(otp: string) {
    const result = await verifyOtp(email, otp);

    if (!result.success) {
      throw new Error(result.error || "Verification failed. Please try again.");
    }

    setShowOtpModal(false);
    setShowSuccessPopup(false);
    setSubmitError("");
    setSuccessMessage("Account successfully registered.");
    showInfoModal({ variant: "success", title: "Account created", message: "Your E-Balik account is verified and ready. You can now sign in." });
  }

  if (showOtpModal) {
    return (
      <OTPModal
        isOpen={true}
        onClose={() => setShowOtpModal(false)}
        onBack={() => {
          setShowOtpModal(false);
          showInfoModal({ variant: "info", title: "Registration paused", message: "Your details are kept. Submit the form again whenever you are ready for a new code." });
        }}
        onSubmit={handleOtpSubmit}
        email={email}
        title="Verify Your Account"
        description="Enter the 6-digit code sent to your university email to complete registration."
        isLoading={isLoading}
        error={submitError || error || ""}
        backLabel="Back to registration"
      />
    );
  }

  return (
    <div className="relative flex flex-col gap-5 items-start p-10 w-[620px] max-w-[92vw] my-10 max-h-[calc(100vh-80px)] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.7)_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/80 rounded-2xl border border-line bg-white/98 backdrop-blur-sm">
      <button
        onClick={onClose}
        className="absolute top-5 right-5 text-slate-500 hover:text-navy-800 transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100"
      >
        <X size={18} />
      </button>

      {/* UMak branding — clay chip */}
      <div className="flex items-center gap-3 w-full">
        <div className="flex items-center justify-center rounded-xl size-[52px] border border-[#e8edf5] bg-white">
          <img alt="University of Makati" className="size-[38px] object-contain" src={umakLogo} />
        </div>
        <div>
          <p className="font-semibold text-navy-800 text-[13px] leading-tight" style={{ fontFamily: 'var(--font-heading)' }}>UNIVERSITY OF MAKATI</p>
          <p className="font-bold text-[#d1a153] text-[12px] leading-tight tracking-wide">E-BALIK SYSTEM</p>
        </div>
      </div>

      <div className="w-full h-px bg-line" />

      <div>
        <p className="font-semibold text-navy-800 text-[24px]" style={{ fontFamily: 'var(--font-heading)' }}>Create Your Account</p>
        <p className="text-ink-muted text-[14px] mt-1">Register with your UM institutional credentials</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
        <div className="rounded-[16px] border border-[#dfeaf6] bg-[#fffbeb] p-4 text-[12px] text-slate-700">
          <div className="mb-1 flex items-center gap-2 font-bold text-navy-800">
            <Sparkles size={13} className="text-[#d1a153]" /> Account profile auto-detection
          </div>
          <p>Role is auto-detected from your email and campus ID. Student emails like <span className="font-semibold text-navy-800">name.k12345678@umak.edu.ph</span> are recognized automatically.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full">
          {[{ label: 'First Name', value: firstName, setter: setFirstName, placeholder: 'Juan', required: true },
            { label: 'Middle Name', value: middleName, setter: setMiddleName, placeholder: '(Optional)', required: false },
            { label: 'Last Name', value: lastName, setter: setLastName, placeholder: 'Dela Cruz', required: true }].map(({ label, value, setter, placeholder, required }) => (
            <div key={label} className="flex flex-col gap-2">
              <label className="font-bold text-navy-800 text-[12px] tracking-wide uppercase">{label}</label>
              <input type="text" value={value} onChange={(e) => setter(e.target.value)}
                placeholder={placeholder} required={required} className={clayInput} />
            </div>
          ))}
        </div>

        {/* Email + Student ID side by side */}
        <div className="flex gap-3">
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <label className="font-bold text-navy-800 text-[12px] tracking-wide uppercase">University Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())}
              placeholder="username@umak.edu.ph" required className={clayInput} />
          </div>
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <label className="font-bold text-navy-800 text-[12px] tracking-wide uppercase">Student/Employee ID</label>
            <input type="text" value={studentId} onChange={(e) => setStudentId(e.target.value)}
              placeholder="e.g. A2023-12345" className={clayInput} />
          </div>
        </div>

        {/* Password */}
        <div className="flex flex-col gap-2">
          <label className="font-bold text-navy-800 text-[12px] tracking-wide uppercase">Password</label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 16 characters"
              required
              className={`${tried && !pwValid ? clayInputError : clayInput} pr-11`}
            />
            <button type="button" onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-ink-soft transition-colors">
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {password.length > 0 && (
            <div className="rounded-xl border border-line p-3 grid grid-cols-2 gap-1.5 bg-slate-50">
              <PasswordRule ok={pwChecks.length} label="At least 16 characters" />
              <PasswordRule ok={pwChecks.upper} label="Uppercase (A–Z)" />
              <PasswordRule ok={pwChecks.lower} label="Lowercase (a–z)" />
              <PasswordRule ok={pwChecks.number} label="Number (0–9)" />
              <PasswordRule ok={pwChecks.special} label="Special character (!@#...)" />
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div className="flex flex-col gap-2">
          <label className="font-bold text-navy-800 text-[12px] tracking-wide uppercase">Confirm Password</label>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              required
              className={`${confirmPassword.length > 0 && !pwMatch ? clayInputError : clayInput} pr-11`}
            />
            <button type="button" onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-ink-soft transition-colors">
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {confirmPassword.length > 0 && !pwMatch && (
            <p className="text-red-500 text-[12px]">Passwords do not match.</p>
          )}
          {confirmPassword.length > 0 && pwMatch && (
            <p className="text-green-600 text-[12px] flex items-center gap-1">
              <CheckCircle2 size={12} /> Passwords match
            </p>
          )}
        </div>

        {(submitError || error) && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800 text-[13px]">
            {submitError || error}
          </div>
        )}

        {successMessage && !showOtpModal && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-700">
            <div className="font-bold">Success</div>
            <div className="mt-1">{successMessage}</div>
          </div>
        )}

        <div id="register-google-signin-button" className="w-full" />

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-[16px] border bg-navy-800 hover:bg-navy-700 text-white font-bold text-[15px] h-[52px] w-full transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? "Registering…" : "Register"}
        </button>
      </form>

      <div className="w-full h-px bg-line" />

      <div className="flex gap-1 items-center justify-center w-full">
        <span className="text-ink-muted text-[14px]">Already have an account?</span>
        <button
          onClick={onSwitchToLogin}
          className="font-bold text-navy-800 text-[14px] underline hover:text-[#d1a153] transition-colors"
        >
          Log In
        </button>
      </div>

    </div>
  );
}
