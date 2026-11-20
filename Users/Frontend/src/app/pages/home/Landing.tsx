import { useEffect, useState } from "react";
import { motion, AnimatePresence, MotionConfig } from "motion/react";
import { ArrowUpRight, HeartHandshake, ScanLine, ShieldCheck } from "lucide-react";
import LandingHero from "./LandingHero";
import LandingCampusGallery from "./LandingCampusGallery";
import "./landing.css";
import umakLogo from "@/imports/umaklogo.webp";
import headerUmSeal from "@/imports/Header/9aefa1789ba406d6291f8aa816f84df70a02953b.webp";
import svgPaths from "@/imports/OverlaidContent/svg-axip1y38u4";
import type { ModalState } from "@/app/types";
import Login from "@/app/pages/home/Login";
import Register from "@/app/pages/home/Register";
import ForgotPasswordModal from "@/app/pages/home/ForgotPasswordModal";
import { publicApi, type PublicBoard } from "@/app/utils/api";
import { useAuctionFeed } from "@/app/utils/auctions";
import LiveBoard from "@/app/pages/home/LiveBoard";
import AuctionShowcase from "@/app/shared/auction/AuctionShowcase";

// ─── SVG icon components (all original paths preserved) ──────────────────────

function IconSearchLg() {
  return (
    <svg fill="none" height="26" viewBox="0 0 24 24" width="26">
      <path d={svgPaths.p1cfabb40} stroke="#1f3160" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
function IconLink() {
  return (
    <svg fill="none" height="26" viewBox="0 0 24 24" width="26">
      <path d={svgPaths.p3bdf9b60} stroke="#1f3160" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg fill="none" height="26" viewBox="0 0 24 24" width="26">
      <path d={svgPaths.p26f66600} stroke="#1f3160" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
// spring preset for bouncy clay feel
const spring = { type: "spring", stiffness: 400, damping: 28 } as const;

// ─── Feature Card ─────────────────────────────────────────────────────────────

function FeatureCard({ icon, title, desc, step, color }: {
  icon: React.ReactNode; title: string; desc: string; step: string; color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      whileHover={{ y: -6, scale: 1.02 }}
      transition={{ ...spring, opacity: { duration: 0.35 } }}
      viewport={{ once: true }}
      className="landing-feature-card flex flex-col gap-5 items-start p-8 flex-1 min-w-0 cursor-default"
    >
      <div className="flex items-start justify-between w-full">
        <div
          className="flex items-center justify-center rounded-[16px] size-[56px] border"
          style={{ background: color, borderColor: "rgba(255,255,255,0.6)" }}
        >
          {icon}
        </div>
        <span className="landing-feature-step font-bold text-[44px] leading-none select-none">{step}</span>
      </div>
      <div className="flex flex-col gap-2">
        <p className="landing-feature-title font-bold text-[18px]" style={{ fontFamily: "var(--font-heading)" }}>{title}</p>
        <p className="landing-feature-description text-[14px] leading-[22px]">{desc}</p>
      </div>
    </motion.div>
  );
}

// ─── Landing ──────────────────────────────────────────────────────────────────

export default function Landing({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [modal, setModal] = useState<ModalState | "forgot-password">("none");
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState(false);
  const [boardRevision, setBoardRevision] = useState(0);
  const { feed: auctionFeed } = useAuctionFeed(60000);
  const liveAuctionCount = (auctionFeed?.live ?? []).filter((a) => a.status === "live").length;

  // Newest missing reports and found items (safe public fields only)
  useEffect(() => {
    let active = true; setBoardLoading(true); setBoardError(false);
    void publicApi.board().then((response) => {
      if (active) { if (!response.error && response.data) setBoard(response.data); else { setBoard(null); setBoardError(true); } }
    }).catch(() => { if (active) { setBoard(null); setBoardError(true); } }).finally(() => {
      if (active) setBoardLoading(false);
    });
    return () => { active = false; };
  }, [boardRevision]);

  return (
    <MotionConfig reducedMotion="user"><div className="ebalik-landing min-h-screen flex flex-col relative overflow-x-hidden">
      <a className="landing-skip" href="#landing-main">Skip to content</a>

      {/* ══════════════════════════════════════════════ HEADER */}
      <header className="landing-header">
        <a className="landing-brand" href="#landing-main" aria-label="E-Balik home"><img src={headerUmSeal} alt="" width={44} height={44} /><div><strong>E-Balik<span>UNIVERSITY OF MAKATI</span></strong></div></a>
        <nav aria-label="Explore E-Balik"><a href="#campus-board">Lost &amp; found</a><a href="#how-it-works">How it works</a></nav>
        <div className="landing-header-actions"><button className="landing-login" onClick={() => setModal("login")}>Log in</button><button className="landing-button landing-button-primary landing-button-small" onClick={() => setModal("register")}>Join E-Balik<ArrowUpRight size={15} /></button></div>
      </header>

      {/* Page body — blurred when modal open */}
      <main id="landing-main" tabIndex={-1} className={`landing-main flex-1 transition-[filter] duration-300 ${modal !== "none" ? "blur-sm pointer-events-none select-none" : ""}`}>

        {/* ══════════════════════════════════════════════ HERO */}
        <LandingHero onLogin={() => setModal("login")} board={board} loading={boardLoading} liveAuctions={auctionFeed ? liveAuctionCount : null} />
        <div className="landing-community-band"><p>SMALL ACTS. MEANINGFUL RETURNS.</p><div><span><HeartHandshake size={17} />A campus that cares</span><span><ScanLine size={17} />Connected through Smart Tags</span><span><ShieldCheck size={17} />Ownership checked by staff</span></div></div>

        {/* ══════════════════════════════════════════════ LIVE BOARD: recent missing reports + found items */}
        <div id="campus-board" className="landing-board-anchor">{boardError ? <div className="landing-board-error" role="status"><h2>Campus updates are taking a moment</h2><p>We couldn’t load the latest reports. Your sign-in and reporting options are still available.</p><button className="landing-button landing-button-outline" onClick={() => setBoardRevision((value) => value + 1)}>Retry campus board</button></div> : <LiveBoard board={board} loading={boardLoading} onLogin={() => setModal("login")} />}</div>

        {/* ══════════════════════════════════════════════ AUCTION HALL SHOWCASE */}
        <AuctionShowcase onLogin={() => setModal("login")} />

        {/* ══════════════════════════════════════════════ HOW IT WORKS */}
        <LandingCampusGallery />
        <section id="how-it-works" className="landing-how border-t border-[#e8edf5] flex flex-col gap-14 items-center px-8 md:px-16 pt-24 pb-24 w-full">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            viewport={{ once: true }}
            className="text-center"
          >
            {/* Clay pill label */}
            <span className="landing-how-label mb-3 inline-block text-[12px] font-semibold">
              How It Works
            </span>
            <h2
              className="landing-how-title font-semibold text-[32px] md:text-[36px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              A simpler way back to you
            </h2>
            <p className="landing-how-description text-[15px] mt-3 max-w-[460px] mx-auto leading-relaxed">
              Three simple steps to reunite students and staff with their belongings.
            </p>
          </motion.div>

          <div className="flex flex-col md:flex-row gap-6 w-full max-w-[1100px]">
            <FeatureCard step="01" icon={<IconLink />}    title="Automated matching"        color="linear-gradient(135deg,#eef4ff,#dbeafe)" desc="Describe your missing item. E-Balik compares reports to help you find possible matches around campus." />
            <FeatureCard step="02" icon={<IconSearchLg />} title="Inventory search"          color="linear-gradient(135deg,#fffbeb,#fef3c7)" desc="Browse real-time categorized logs of found keys, electronics, valuables, and accessories around campus." />
            <FeatureCard step="03" icon={<IconShield />}  title="Secure pickup verification" color="linear-gradient(135deg,#ecfdf5,#d1fae5)" desc="Staff review ownership evidence and verify pickup before recording a return to the owner." />
          </div>
        </section>

        {/* ══════════════════════════════════════════════ FOOTER */}
        <footer className="bg-navy-900 flex flex-col w-full">
          {/* Gold→Yellow gradient top border */}
          <div className="h-[4px] w-full bg-[#d1a153]" />

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 px-8 md:px-16 pt-14 pb-10 w-full">
            {/* Clay logo block */}
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center rounded-[16px] size-[56px] bg-navy-800 border border-white/15">
                <img decoding="async" alt="UMak Logo" className="size-[40px] object-contain" src={umakLogo} />
              </div>
              <div>
                <p className="font-bold text-white text-[15px]" style={{ fontFamily: "var(--font-heading)" }}>
                  E-BALIK LOST &amp; FOUND SYSTEM
                </p>
                <p className="text-[#d1a153] text-[13px] mt-0.5">Made for the University of Makati community</p><p className="landing-footer-summary">A shared place for lost belongings, thoughtful finders and meaningful returns.</p>
              </div>
            </div>
            <div className="flex gap-6 flex-wrap">
              <a href="/privacy" className="text-white/55 text-[13px] hover:text-gold-300 transition-colors duration-200 font-medium">Privacy policy</a>
              <a href="#how-it-works" className="text-white/70 text-[13px] hover:text-gold-300">How it works</a>
              <a href="https://www.umak.edu.ph/help/directory/" target="_blank" rel="noreferrer" className="text-white/70 text-[13px] hover:text-gold-300">University directory</a>
            </div>
          </div>

          <div className="mx-8 md:mx-16 h-px bg-white/10" />
          <p className="text-white/60 text-[12px] px-8 md:px-16 py-6">
            E-Balik · University of Makati community lost & found.
          </p>
          <p className="landing-photo-credit">Campus photograph: <a href="https://commons.wikimedia.org/wiki/File:University_of_Makati_Oval.jpg" target="_blank" rel="noreferrer">Steverv0206 / Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>. Archival campus view, 2012. Resized and displayed with a responsive crop and overlay; no endorsement implied.</p>
        </footer>
      </main>

      {/* ══════════════════════════════════════════════ MODAL OVERLAY */}
      <AnimatePresence>
        {modal !== "none" && (
          <motion.div
            key="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overscroll-contain sm:items-center sm:px-4"
            role="presentation"
          >
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-navy-950/60 backdrop-blur-md"
              onClick={() => setModal("none")}
            />

            {/* Modal content with spring entrance */}
            <motion.div
              key={modal}
              initial={{ opacity: 0, y: 48 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 32 }}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
              className="relative z-10 flex w-full items-end justify-center sm:w-auto sm:items-center sm:py-8"
            >
              {modal === "login" ? (
                <Login
                  onClose={() => setModal("none")}
                  onSwitchToRegister={() => setModal("register")}
                  onForgotPassword={() => setModal("forgot-password")}
                  onLoginSuccess={onLoginSuccess}
                />
              ) : modal === "forgot-password" ? (
                <ForgotPasswordModal onClose={() => setModal("none")} onBackToLogin={() => setModal("login")} />
              ) : (
                <Register
                  onClose={() => setModal("none")}
                  onSwitchToLogin={() => setModal("login")}
                  onRegisterSuccess={onLoginSuccess}
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div></MotionConfig>
  );
}
