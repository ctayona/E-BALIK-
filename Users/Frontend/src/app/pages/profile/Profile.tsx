import { useEffect, useRef, useState } from "react";
import { ArrowLeft, IdCard, Save, UserRound, CheckCircle2 } from "lucide-react";
import { motion } from "motion/react";
import type { Page } from "@/app/types";
import { useAuth } from "@/app/utils/useAuth";
import type { User } from "@/app/utils/useAuth";
import { CX, SPRING } from "@/app/utils/clay";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";
import Modal from "@/app/shared/modal/Modal";
import DataPrivacyConsent from "@/app/shared/privacy/DataPrivacyConsent";
import { useCurrentUser } from "@/app/utils/system";
import { showSubmitError } from "@/app/utils/submitErrors";
import VerificationStatusCard, { assignedRole } from "@/app/shared/verification/VerificationStatusCard";
import EmailPreferencesCard from "@/app/shared/profile/EmailPreferencesCard";

export default function Profile({
  user: userProp,
  onNavigate,
}: {
  user: User | null;
  onNavigate: (page: Page) => void;
}) {
  const { updateProfile, uploadVerificationDocument, refreshProfile, isLoading } = useAuth();
  // Read the freshest copy of the user, so an admin's approval appears here without signing out and in again.
  const stored = useCurrentUser() as User | null;
  const user = stored ?? userProp;
  const [dpaChecked, setDpaChecked] = useState(false);
  const [formData, setFormData] = useState({
    fname:     user?.fname     ?? "",
    mname:     user?.mname     ?? "",
    lname:     user?.lname     ?? "",
    campus_id: user?.campus_id ?? "",
    email:     user?.email     ?? "",
    user_role: user?.user_role ?? "Others",
  });
  const [showConfirmModal,     setShowConfirmModal]     = useState(false);
  const [showUploadModal,      setShowUploadModal]      = useState(false);
  const [selectedDocumentType, setSelectedDocumentType] = useState<"cor" | "student_id" | "government_id">("cor");
  const [confirmValue,         setConfirmValue]         = useState("");
  const [errorMessage,         setErrorMessage]         = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Ask the server for the latest status every few seconds while the account is not verified yet.
  const verified = String(user?.verification_status || "").toLowerCase() === "verified";
  useEffect(() => {
    void refreshProfile();
    if (verified) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refreshProfile(); }, 6000);
    return () => window.clearInterval(timer);
  }, [verified, refreshProfile]);

  useEffect(() => {
    if (!user) return;
    setFormData({
      fname:     user.fname     ?? "",
      mname:     user.mname     ?? "",
      lname:     user.lname     ?? "",
      campus_id: user.campus_id ?? "",
      email:     user.email     ?? "",
      user_role: user.user_role ?? "Others",
    });
  }, [user]);

  function handleChange(field: keyof typeof formData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleDocumentUpload(file: File) {
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      setErrorMessage("Choose a JPG, PNG, WEBP, or PDF document.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("Verification documents must be 10 MB or smaller.");
      return;
    }
    const result = await uploadVerificationDocument({
      document: file,
      document_type: selectedDocumentType,
      dpa_consent: dpaChecked,
    });
    if (!result.success) {
      setShowUploadModal(false);
      showSubmitError(result as { error?: string; errorCode?: string }, "Document not uploaded", "Verification upload failed.");
      return;
    }
    showInfoModal({
      variant: "success",
      title: "Verification document received",
      message: "Your account verification request is pending administrator review. You'll be notified once it's approved.",
      details: [`File: ${result.document_name || file.name}`],
    });
    setErrorMessage("");
    setShowUploadModal(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setShowConfirmModal(true);
  }

  async function handleConfirmSave() {
    if (confirmValue.trim() !== "YES") { setErrorMessage("Please type YES exactly to confirm the update."); return; }
    const result = await updateProfile({
      fname: formData.fname, mname: formData.mname, lname: formData.lname,
      email: formData.email, campus_id: formData.campus_id, user_role: formData.user_role,
    });
    if (!result.success) {
      setShowConfirmModal(false);
      showInfoModal({ variant: "error", title: "Profile not updated", message: result.error || "Profile update failed." });
      return;
    }
    showInfoModal({ variant: "success", title: "Profile updated", message: "Your account details have been saved." });
    setConfirmValue("");
    setShowConfirmModal(false);
    setErrorMessage("");
  }

  const fullName = `${formData.fname} ${formData.mname ? `${formData.mname} ` : ""}${formData.lname}`.trim();
  const clayFieldInput = `${CX.input} h-[48px] w-full`;
  const clayFieldReadonly = "h-[48px] w-full rounded-xl border border-line-strong bg-slate-100 px-4 text-[14px] text-ink-muted outline-none cursor-not-allowed ";

  return (
    <div className={CX.page}>
      <div className="mx-auto max-w-[880px]">

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8 flex items-center justify-between gap-4"
        >
          <div>
            <span className={CX.sectionLabel}>Profile</span>
            <h1 className="text-[30px] font-semibold text-navy-800 mt-1" style={{ fontFamily: "var(--font-heading)" }}>
              Account details
            </h1>
          </div>
          <motion.button
            whileHover={{ y: -2, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={SPRING}
            type="button"
            onClick={() => onNavigate("dashboard")}
            className={`${CX.btnGhost} px-5 py-2.5 text-[13px]`}
          >
            <ArrowLeft size={15} aria-hidden="true" /> Back to dashboard
          </motion.button>
        </motion.div>

        <VerificationStatusCard user={user} busy={isLoading} onUpload={() => { setErrorMessage(""); setDpaChecked(false); setShowUploadModal(true); }} />

        {/* Main clay card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className={`${CX.card} overflow-hidden`}
        >
          {/* Profile header band */}
          <div className="flex items-center justify-between gap-4 px-7 py-6 bg-[#253d7a] border-b-[2px] border-gold-400/20">
            <div className="flex items-center gap-4">
              <div className="flex size-[54px] items-center justify-center rounded-full bg-gold-500 hover:bg-gold-400 text-navy-800 border border-[#e8c070]/50">
                <UserRound size={24} />
              </div>
              <div>
                <p className="text-[16px] font-bold text-white">{fullName || "Student Profile"}</p>
                <p className="text-[13px] text-white/60 mt-0.5">{user?.email || "No email on file"}</p>
              </div>
            </div>
            <span className={CX.badgeGold}>Active account</span>
          </div>

          {/* Form body */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-6 p-6 md:p-8">
            {errorMessage && <div className={CX.alertError}>{errorMessage}</div>}

            {/* Name fields */}
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { label: "First name",  field: "fname" as const, placeholder: "Juan" },
                { label: "Middle name", field: "mname" as const, placeholder: "(Optional)" },
                { label: "Last name",   field: "lname" as const, placeholder: "Dela Cruz" },
              ].map(({ label, field, placeholder }) => (
                <div key={field} className="flex flex-col gap-2">
                  <label className="text-[12px] font-bold text-navy-800">{label}</label>
                  <input
                    value={formData[field]}
                    onChange={(e) => handleChange(field, e.target.value)}
                    placeholder={placeholder}
                    className={clayFieldInput}
                  />
                </div>
              ))}
            </div>

            {/* ID + Role (read-only) */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[12px] font-bold text-navy-800">
                  <IdCard size={14} className="text-[#d1a153]" /> Campus ID
                </label>
                <input value={formData.campus_id} readOnly className={clayFieldReadonly} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-bold text-navy-800">Role</label>
                <input value={assignedRole(user) ?? "Assigned when you are verified"} readOnly className={clayFieldReadonly} />
              </div>
            </div>

            {/* Save */}
            <div className="flex justify-end">
              <motion.button
                type="submit"
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={SPRING}
                className={`${CX.btnGold} flex items-center gap-2 px-7 py-3 text-[14px]`}
              >
                <Save size={15} /> Save Changes
              </motion.button>
            </div>
          </form>
        </motion.div>

        <EmailPreferencesCard />
      </div>

      {/* Upload type modal */}
      <Modal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        size="md"
        tone="iris"
        icon={<IdCard size={21} />}
        eyebrow="Verification document"
        title="Choose a document type"
        description={user?.email?.endsWith("@umak.edu.ph")
          ? (user?.user_role === "Faculty"
            ? "Faculty accounts are encouraged to upload a Student / Campus ID."
            : "Student accounts are encouraged to upload a Certificate of Registration (COR).")
          : "Upload the document that best confirms your identity for account verification."}
        footer={
          <>
            <button type="button" onClick={() => setShowUploadModal(false)} className={CX.btnGhost}>Cancel</button>
            <button type="button" disabled={!dpaChecked} onClick={() => { setShowUploadModal(false); cameraInputRef.current?.click(); }} className={CX.btnNavy}>Take photo</button>
            <button type="button" disabled={!dpaChecked} onClick={() => { setShowUploadModal(false); fileInputRef.current?.click(); }} className={CX.btnNavy}>Upload photo or PDF</button>
          </>
        }
      >
        <div role="radiogroup" aria-label="Document type" className="flex flex-col gap-3">
          {[
            { id: "cor", label: "Certificate of Registration (COR)", description: "Recommended for students." },
            { id: "student_id", label: "Student / Campus ID", description: "Recommended for faculty or staff." },
            { id: "government_id", label: "Government ID", description: "Alternative valid identification." },
          ].map((doc) => {
            const active = selectedDocumentType === doc.id;
            return (
              <button
                key={doc.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelectedDocumentType(doc.id as "cor" | "student_id" | "government_id")}
                className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-[border-color,background-color,box-shadow] ${
                  active ? "border-iris-400 bg-iris-50 shadow-[0_0_0_4px_rgba(110,142,240,0.15)]" : "border-line bg-white hover:border-iris-200 hover:bg-frost-50"
                }`}
              >
                <span>
                  <span className="block text-[15px] font-semibold text-ink">{doc.label}</span>
                  <span className="mt-0.5 block text-[13px] text-ink-muted">{doc.description}</span>
                </span>
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${active ? "border-iris-500 bg-iris-500 text-white" : "border-line-strong"}`}>
                  {active && <CheckCircle2 size={14} aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </div>
        <p className={`${CX.helper} mt-3`}>JPG, PNG, WEBP or PDF up to 10 MB. Only administrators can see this document.</p>
        <div className="mt-4"><DataPrivacyConsent checked={dpaChecked} onChange={setDpaChecked} purpose="verify your identity and assign your account role" /></div>
      </Modal>

      {/* Confirm save modal */}
      <Modal
        open={showConfirmModal}
        onClose={() => { setShowConfirmModal(false); setConfirmValue(""); }}
        size="sm"
        tone="navy"
        icon={<Save size={20} />}
        eyebrow="Confirmation required"
        title="Save profile changes?"
        description="Type YES to confirm you want to save these changes to your account."
        footer={
          <>
            <button type="button" onClick={() => { setShowConfirmModal(false); setConfirmValue(""); }} className={CX.btnGhost}>Cancel</button>
            <button type="button" disabled={confirmValue.trim() !== "YES"} onClick={() => void handleConfirmSave()} className={CX.btnNavy}>Save changes</button>
          </>
        }
      >
        <label htmlFor="profile-confirm-yes" className={CX.label}>Type YES to continue</label>
        <input
          id="profile-confirm-yes"
          data-autofocus
          value={confirmValue}
          onChange={(e) => setConfirmValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && confirmValue.trim() === "YES") void handleConfirmSave(); }}
          placeholder="YES"
          autoComplete="off"
          autoCapitalize="characters"
          className={`${CX.input} w-full text-center font-semibold tracking-[0.3em]`}
        />
        {errorMessage && <div role="alert" className={`${CX.alertError} mt-3`}>{errorMessage}</div>}
      </Modal>

      {/* Camera input: opens the camera app on a phone; the next input is the gallery or file picker. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleDocumentUpload(file);
          e.target.value = "";
        }}
      />
      {/* Hidden file input (unchanged) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleDocumentUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
