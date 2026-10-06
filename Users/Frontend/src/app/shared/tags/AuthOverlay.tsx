import { useState } from "react";
import Login from "@/app/pages/home/Login";
import Register from "@/app/pages/home/Register";
import ForgotPasswordModal from "@/app/pages/home/ForgotPasswordModal";

type Step = "login" | "register" | "forgot";

/** Sign in or create an account without leaving the page (the Smart Tag page uses it for "Log in to claim it"). */
export default function AuthOverlay({ initial = "login", onClose, onSignedIn }: { initial?: Step; onClose: () => void; onSignedIn: () => void }) {
  const [step, setStep] = useState<Step>(initial);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto overscroll-contain sm:items-center sm:px-4" role="presentation">
      <div className="fixed inset-0 bg-navy-950/60 backdrop-blur-md" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 flex w-full items-end justify-center sm:w-auto sm:items-center sm:py-8">
        {step === "login" && <Login onClose={onClose} onSwitchToRegister={() => setStep("register")} onForgotPassword={() => setStep("forgot")} onLoginSuccess={onSignedIn} />}
        {step === "register" && <Register onClose={onClose} onSwitchToLogin={() => setStep("login")} onRegisterSuccess={onSignedIn} />}
        {step === "forgot" && <ForgotPasswordModal onClose={onClose} onBackToLogin={() => setStep("login")} />}
      </div>
    </div>
  );
}
