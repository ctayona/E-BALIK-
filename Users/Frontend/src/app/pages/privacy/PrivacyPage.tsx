import { ArrowLeft, Clock3, Eye, FileLock2, Mail, Trash2 } from "lucide-react";

/**
 * The short data privacy page, public at /privacy. The retention periods match the server defaults
 * (EVIDENCE_RETENTION_DAYS, CLAIM_PICKUP_DAYS in Server/app/utils/housekeeping.py, RECYCLE_BIN_DAYS in recycle_bin.py): update both together.
 */
const SECTIONS: Array<{ icon: React.ReactNode; title: string; body: React.ReactNode }> = [
  {
    icon: <Eye size={20} aria-hidden="true" />,
    title: "What we collect, and why",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li><strong>Your account:</strong> name, campus ID, email and a password stored only as a one-way hash. We use them to sign you in and to contact you about your reports and claims.</li>
        <li><strong>Your reports and claims:</strong> descriptions, photos and where and when something was lost or found, so the Lost and Found Office can match items with their owners.</li>
        <li><strong>Proof of identity:</strong> a school or government ID you upload to verify your account or to support a claim. Only administrators can open it.</li>
        <li><strong>Smart Tags:</strong> the item name and photo you register, and only the contact details you choose to show a finder.</li>
      </ul>
    ),
  },
  {
    icon: <FileLock2 size={20} aria-hidden="true" />,
    title: "Who can see it",
    body: <p>Other users never see your email, campus ID or documents. Auction pages show bidders only as an anonymous alias. Administrators and the release-desk guard see what they need to do their work, and what they do is recorded in an activity log.</p>,
  },
  {
    icon: <Clock3 size={20} aria-hidden="true" />,
    title: "How long we keep it",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li><strong>ID documents and proof photos</strong> leave the claim <strong>30 days</strong> after it is closed (collected or rejected), and 30 days after an account verification is reviewed. They then wait in an administrators-only recycle bin for <strong>30 more days</strong>, so a mistake can be undone, and are deleted for good after that.</li>
        <li>When an administrator deletes an account, report or claim, it also waits in the recycle bin for 30 days before it is gone for good.</li>
        <li>An approved claim that is not collected closes automatically after <strong>14 days</strong>.</li>
        <li>The record of the report or claim itself is kept so the office can show what happened. Verification codes are short-lived and are cleared regularly.</li>
      </ul>
    ),
  },
  {
    icon: <Mail size={20} aria-hidden="true" />,
    title: "Emails we send",
    body: <p>Important emails (verification codes, claim decisions, handover receipts) are always sent. Reminders and announcements are optional: switch them off any time under <strong>Profile</strong>, or with the unsubscribe link in the email. We never ask for your password or a verification code by email, chat or phone.</p>,
  },
  {
    icon: <Trash2 size={20} aria-hidden="true" />,
    title: "Your rights",
    body: <p>Under the Philippine Data Privacy Act of 2012 (RA 10173) you may ask to see, correct or delete your personal data, or withdraw your consent. Email <a href="mailto:ebaliksupport@gmail.com" className="font-semibold underline underline-offset-2">ebaliksupport@gmail.com</a> or visit the Lost and Found Office, and we will respond promptly.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <main className="app-canvas min-h-screen px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <div className="mx-auto w-full max-w-[760px]">
        <a href="/" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-navy-700 underline-offset-2 hover:underline"><ArrowLeft size={15} aria-hidden="true" />Back to E-Balik</a>
        <p className="mt-6 text-[13px] font-semibold text-gold-700">University of Makati · E-Balik Lost &amp; Found</p>
        <h1 className="mt-1 font-[family-name:var(--font-heading)] text-[32px] font-semibold leading-tight tracking-[-0.02em] text-ink md:text-[40px]">Data privacy</h1>
        <p className="mt-3 max-w-[62ch] text-[15.5px] leading-7 text-ink-muted">E-Balik only keeps what it needs to return lost things to their owners, and it deletes sensitive files once a case is finished. This is how it works.</p>
        <div className="mt-8 space-y-4">
          {SECTIONS.map((section) => (
            <section key={section.title} className="rounded-[20px] border border-white/80 bg-white/90 p-6 shadow-card">
              <h2 className="flex items-center gap-3 font-[family-name:var(--font-heading)] text-[19px] font-semibold text-ink">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#f3dcab,#d1a153)] text-navy-950">{section.icon}</span>
                {section.title}
              </h2>
              <div className="mt-3 text-[14.5px] leading-7 text-ink-soft">{section.body}</div>
            </section>
          ))}
        </div>
        <p className="mt-8 text-[12.5px] text-ink-muted">Questions? Call 09478685684 or email ebaliksupport@gmail.com.</p>
      </div>
    </main>
  );
}
