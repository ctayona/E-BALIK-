import { useEffect, useRef, useState } from "react";
import { IdCard, Save, Upload, UserRound, CheckCircle2, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Page } from "@/app/types";
import { useAuth } from "@/app/utils/useAuth";
import type { User } from "@/app/utils/useAuth";
import { CX, SPRING } from "@/app/utils/clay";
import { showInfoModal } from "@/app/shared/info-modal/infoModalStore";

export default function Profile({
  user,
  onNavigate,
}: {
  user: User | null;
  onNavigate: (page: Page) => void;
}) {
  const { updateProfile, uploadVerificationDocument, isLoading } = useAuth();
  const [formData, setFormData] = useState({
    fname:     user?.fname     ?? "",
    mname:     user?.mname     ?? "",
    lname:     user?.lname     ?? "",
    campus_id: user?.campus_id ?? "",
    email:     user?.email     ?? "",
    user_role: user?.user_role ?? "Others",
  });
  const [documentName,         setDocumentName]         = useState(user?.verification_document_name ?? "");
  const [showConfirmModal,     setShowConfirmModal]     = useState(false);
  const [showUploadModal,      setShowUploadModal]      = useState(false);
  const [selectedDocumentType, setSelectedDocumentType] = useState<"cor" | "student_id" | "government_id">("cor");
  const [confirmValue,         setConfirmValue]         = useState("");
  const [errorMessage,         setErrorMessage]         = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setDocumentName(user.verification_document_name ?? "");
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
    });
    if (!result.success) {
      setShowUploadModal(false);
      showInfoModal({ variant: "error", title: "Document not uploaded", message: result.error || "Verification upload failed." });
      return;
    }
    showInfoModal({
      variant: "success",
      title: "Verification document received",
      message: "Your account verification request is pending administrator review. You'll be notified once it's approved.",
      details: [`File: ${result.document_name || file.name}`],
    });
    setDocumentName(result.document_name || file.name);
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
              Account Details
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
            ← Dashboard
          </motion.button>
        </motion.div>

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
            <span className={CX.badgeGold}>Active Account</span>
          </div>

          {/* Form body */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-6 p-6 md:p-8">
            {/* Verification reminder */}
            <div className={`${user?.verification_status === "verified" ? CX.alertSuccess : CX.alertInfo} flex items-start gap-3`}>
              <ShieldCheck size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.18em] mb-1">Account Verification</p>
                <p className="text-[14px] text-navy-800">
                  {user?.verification_status === "verified"
                    ? "Your identity document has been reviewed and your account is verified."
                    : user?.verification_status === "pending"
                      ? "Your verification request is awaiting administrator review."
                      : user?.verification_status === "rejected"
                        ? "Your document needs attention. Review the administrator note and upload a corrected document."
                        : "Upload a school or government document to verify your identity and account category."}
                </p>
                {user?.verification_review_note && <p className="mt-2 text-[13px] font-semibold text-rose-700">Review note: {user.verification_review_note}</p>}
              </div>
            </div>

            {errorMessage && <div className={CX.alertError}>{errorMessage}</div>}

            {/* Name fields */}
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { label: "First Name",  field: "fname" as const, placeholder: "Juan" },
                { label: "Middle Name", field: "mname" as const, placeholder: "(Optional)" },
                { label: "Last Name",   field: "lname" as const, placeholder: "Dela Cruz" },
              ].map(({ label, field, placeholder }) => (
                <div key={field} className="flex flex-col gap-2">
                  <label className="text-[12px] font-bold uppercase tracking-[0.16em] text-navy-800">{label}</label>
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
                <label className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-navy-800">
                  <IdCard size={14} className="text-[#d1a153]" /> Campus ID
                </label>
                <input value={formData.campus_id} readOnly className={clayFieldReadonly} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-bold uppercase tracking-[0.16em] text-navy-800">Role</label>
                <input value={formData.user_role || "Others"} readOnly className={clayFieldReadonly} />
              </div>
            </div>

            {/* Role info */}
            <div className={`${CX.alertInfo}`}>
              <p className="text-[12px] font-bold text-blue-800 mb-1">Incorrect Role?</p>
              <p>If your account type was detected incorrectly, complete your verification steps below to confirm your role before continuing.</p>
            </div>

            {/* Document upload */}
            <div className="rounded-2xl border border-dashed border-gold-400/60 bg-[#fffbeb] p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[14px] font-bold text-navy-800">Verify through Documents</p>
                  <p className="text-[13px] text-ink-muted mt-1 max-w-[440px] leading-relaxed">
                    Upload a valid government or school-issued document to confirm your identity and account role.
                  </p>
                  {documentName && (
                    <p className="mt-2 text-[12px] font-semibold text-navy-800">
                      ✓ {user?.verification_status === "verified" ? "Verified document" : "Submitted document"}: {documentName}
                    </p>
                  )}
                </div>
                <motion.button
                  type="button"
                  onClick={() => { setErrorMessage(""); setShowUploadModal(true); }}
                  disabled={isLoading || user?.verification_status === "verified"}
                  whileHover={{ y: -2, scale: 1.03 }}
                  whileTap={{ scale: 0.98 }}
                  transition={SPRING}
                  className={`${CX.btnNavy} flex items-center gap-2 px-5 py-3 text-[13px] shrink-0`}
                >
                  <Upload size={15} /> {isLoading ? "Uploading…" : user?.verification_status === "verified" ? "Verified" : user?.verification_status === "pending" ? "Replace Document" : "Upload Document"}
                </motion.button>
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
      </div>

      {/* ── Upload type modal ── */}
      <AnimatePresence>
        {showUploadModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/55 px-4 backdrop-blur-[4px]"
          >
            <motion.div
              initial={{ scale: 0.88, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 16 }}
              transition={SPRING}
              className={`${CX.modal} w-full max-w-lg`}
            >
              <span className={CX.sectionLabel}>Verification Document</span>
              <h3 className="text-[22px] font-semibold text-navy-800" style={{ fontFamily: "var(--font-heading)" }}>
                Choose document type
              </h3>
              <p className="text-[14px] text-ink-muted">
                {user?.email?.endsWith('@umak.edu.ph')
                  ? (user?.user_role === 'Faculty'
                    ? 'Faculty accounts are encouraged to upload a Student / Campus ID.'
                    : 'Student accounts are encouraged to upload a Certificate of Registration (COR).')
                  : 'Upload the document that best confirms your identity for account verification.'}
              </p>

              <div className="flex flex-col gap-3 w-full">
                {[
                  { id: 'cor',          label: 'Certificate of Registration (COR)', description: 'Recommended for students.' },
                  { id: 'student_id',   label: 'Student / Campus ID',               description: 'Recommended for faculty or staff.' },
                  { id: 'government_id',label: 'Government ID',                     description: 'Alternative valid identification.' },
                ].map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setSelectedDocumentType(doc.id as "cor" | "student_id" | "government_id")}
                    className={`w-full rounded-[16px] border p-4 text-left transition-colors duration-200 ${
                      selectedDocumentType === doc.id
                        ? 'border-[#1f3160] bg-[#dbeafe] '
                        : 'border-line bg-slate-50 hover:border-line-strong '
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[14px] font-bold text-navy-800">{doc.label}</p>
                        <p className="mt-1 text-[12px] text-ink-muted">{doc.description}</p>
                      </div>
                      {selectedDocumentType === doc.id && <CheckCircle2 size={18} className="text-navy-800 shrink-0" />}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex justify-end gap-3 w-full">
                <button type="button" onClick={() => setShowUploadModal(false)} className={`${CX.btnGhost} px-5 py-2.5 text-[13px]`}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { setShowUploadModal(false); fileInputRef.current?.click(); }}
                  className={`${CX.btnNavy} px-5 py-2.5 text-[13px]`}
                >
                  Continue
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Confirm save modal ── */}
      <AnimatePresence>
        {showConfirmModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/55 px-4 backdrop-blur-[4px]"
          >
            <motion.div
              initial={{ scale: 0.88, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 16 }}
              transition={SPRING}
              className={`${CX.modal} w-full max-w-md`}
            >
              <span className={CX.sectionLabel}>Confirmation Required</span>
              <h3 className="text-[22px] font-semibold text-navy-800" style={{ fontFamily: "var(--font-heading)" }}>
                Save profile changes?
              </h3>
              <p className="text-[14px] text-ink-muted">
                Type <strong className="text-navy-800">YES</strong> to confirm that you want to save these changes to your account.
              </p>
              <input
                value={confirmValue}
                onChange={(e) => setConfirmValue(e.target.value)}
                placeholder="YES"
                className={`${CX.input} h-[50px] w-full`}
              />
              {errorMessage && <div className={CX.alertError}>{errorMessage}</div>}
              <div className="flex justify-end gap-3 w-full">
                <button
                  type="button"
                  onClick={() => { setShowConfirmModal(false); setConfirmValue(""); }}
                  className={`${CX.btnGhost} px-5 py-2.5 text-[13px]`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmSave()}
                  className={`${CX.btnNavy} px-5 py-2.5 text-[13px]`}
                >
                  Confirm Save
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
