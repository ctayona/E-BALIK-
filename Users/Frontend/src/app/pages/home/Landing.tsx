import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import umakLogo from "@/imports/umaklogo.png";
import headerUmSeal from "@/imports/Header/9aefa1789ba406d6291f8aa816f84df70a02953b.png";
import svgPaths from "@/imports/OverlaidContent/svg-axip1y38u4";
import imgItem0 from "@/imports/OverlaidContent/b49e29d1e878a675879b971b78c0f6b7bf360de5.png";
import imgItem1 from "@/imports/OverlaidContent/0823e4e53b38a443f5851ca353f8f6bbe20f42de.png";
import imgItem2 from "@/imports/OverlaidContent/d17f656f410a0a4ef6102c44406b2f313dd1390d.png";
import imgItem3 from "@/imports/OverlaidContent/ef6e46632c1113bdd39677d9964345eb79582284.png";
import type { ModalState } from "@/app/types";
import Login from "@/app/pages/home/Login";
import Register from "@/app/pages/home/Register";
import ForgotPasswordModal from "@/app/pages/home/ForgotPasswordModal";
import { foundItemsApi } from "@/app/utils/api";
import { SkeletonBlock } from "@/app/shared/LoadingSkeleton";

// ─── SVG icon components (all original paths preserved) ──────────────────────

function IconDatabaseSearch() {
  return (
    <svg fill="none" height="36" viewBox="0 0 40 40" width="36">
      <path d={svgPaths.p17efe900} stroke="#d1a153" strokeLinecap="round" strokeWidth="2.5" />
    </svg>
  );
}
function IconPlusCircle() {
  return (
    <svg fill="none" height="20" viewBox="0 0 20 20" width="20">
      <g clipPath="url(#pc)"><path d={svgPaths.p1a4ad880} stroke="#1f3160" strokeLinecap="round" strokeWidth="2" /></g>
      <defs><clipPath id="pc"><rect fill="white" height="20" width="20" /></clipPath></defs>
    </svg>
  );
}
function IconSearchSm() {
  return (
    <svg fill="none" height="20" viewBox="0 0 20 20" width="20">
      <path d={svgPaths.p1615880} stroke="white" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
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
function IconMapPin() {
  return (
    <svg fill="none" height="13" viewBox="0 0 14 14" width="13">
      <path d={svgPaths.p1b8a0e00} stroke="#d1a153" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
function IconCal() {
  return (
    <svg fill="none" height="13" viewBox="0 0 14 14" width="13">
      <g clipPath="url(#cal)"><path d={svgPaths.p38abe4f0} stroke="#94a3b8" strokeLinecap="round" strokeWidth="2" /></g>
      <defs><clipPath id="cal"><rect fill="white" height="14" width="14" /></clipPath></defs>
    </svg>
  );
}

// ─── Data & helpers ───────────────────────────────────────────────────────────

const RECENT_ITEMS = [
  { img: imgItem0, category: "Accessories",     name: "Hydro Flask",      location: "Main Building 3rd Floor", date: "Found Today"         },
  { img: imgItem1, category: "Electronics",     name: "iPhone 13 Pro",    location: "Admin Lobby Lounge",      date: "Found Yesterday"     },
  { img: imgItem2, category: "Personal Effects",name: "Lanyard with Keys",location: "UM Athletic Field",       date: "Found Oct 24, 2026"  },
  { img: imgItem3, category: "Accessories",     name: "Black Umbrella",   location: "Library Study Area",      date: "Found Oct 23, 2026"  },
];

type RecentFoundItem = {
  fpost_id?: string; item_name?: string; category?: string;
  location?: string; found_date?: string; image_url?: string;
};

function formatFoundDate(value?: string) {
  if (!value) return "Found recently";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return `Found ${value}`;
  const today = new Date();
  const diff = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - date.getTime()) / 86400000
  );
  if (diff === 0) return "Found Today";
  if (diff === 1) return "Found Yesterday";
  return `Found ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

// ─── Clay design tokens ───────────────────────────────────────────────────────
// Outer + inner double-shadow = the claymorphism "puff"

const clay = {
  card:      "rounded-2xl border border-white/60 bg-white ",
  cardNavy:  "rounded-2xl border bg-[#1a2d5a] ",
  cardGold:  "rounded-[20px] border border-[#e8c070]/60 bg-gold-500 hover:bg-gold-400 ",
  cardYellow:"rounded-[20px] border border-gold-300 bg-gold-500 ",
  btn:       "rounded-[16px] border bg-navy-800 hover:bg-navy-700  ",
  btnGold:   "rounded-[16px] border border-[#b8892e]/40 bg-gold-500 hover:bg-gold-400  ",
  input:     "rounded-xl border border-line-strong bg-slate-50 ",
};

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
      className={`${clay.card} flex flex-col gap-5 items-start p-8 flex-1 min-w-0 cursor-default`}
    >
      <div className="flex items-start justify-between w-full">
        <div
          className="flex items-center justify-center rounded-[16px] size-[56px] border"
          style={{ background: color, borderColor: "rgba(255,255,255,0.6)" }}
        >
          {icon}
        </div>
        <span className="text-[#e8edf5] font-bold text-[44px] leading-none select-none">{step}</span>
      </div>
      <div className="flex flex-col gap-2">
        <p className="font-bold text-navy-800 text-[18px]" style={{ fontFamily: "var(--font-heading)" }}>{title}</p>
        <p className="text-ink-muted text-[14px] leading-[22px]">{desc}</p>
      </div>
    </motion.div>
  );
}

// ─── Landing ──────────────────────────────────────────────────────────────────

export default function Landing({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [modal, setModal] = useState<ModalState | "forgot-password">("none");
  const [recentItems, setRecentItems] = useState(RECENT_ITEMS);
  const [recentItemsLoading, setRecentItemsLoading] = useState(true);

  // Fetch live found items (original logic untouched)
  useEffect(() => {
    let active = true;
    void foundItemsApi.publicList().then((response) => {
      if (!active || response.error || !response.data?.items?.length) return;
      const items = (response.data.items as RecentFoundItem[]).map((item, index) => ({
        img:      item.image_url || RECENT_ITEMS[index % RECENT_ITEMS.length].img,
        category: item.category  || "Personal Effects",
        name:     item.item_name || "Found item",
        location: item.location  || "University of Makati campus",
        date:     formatFoundDate(item.found_date),
      }));
      setRecentItems(items);
    }).finally(() => {
      if (active) setRecentItemsLoading(false);
    });
    return () => { active = false; };
  }, []);

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden">

      {/* ══════════════════════════════════════════════ HEADER */}
      <header className="sticky top-0 z-20 bg-navy-800/95 backdrop-blur-lg border-b border-white/10 flex items-center justify-between px-6 md:px-16 h-[72px] shrink-0 w-full">
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45 }}
          className="flex items-center gap-4"
        >
          {/* Clay logo chip */}
          <div className="relative flex items-center justify-center rounded-[16px] size-[48px] border border-white/20 bg-navy-800">
            <img alt="UM Seal" className="size-[36px] object-contain rounded-[10px]" src={headerUmSeal} />
            <span className="absolute -bottom-1 -right-1 size-3.5 rounded-full bg-gold-500 border-2 border-[#1a2d5a]" />
          </div>
          <div>
            <p className="font-semibold text-white text-[14px] leading-tight tracking-wide" style={{ fontFamily: "var(--font-heading)" }}>
              UNIVERSITY OF MAKATI
            </p>
            <p className="font-bold text-gold-300 text-[12px] leading-tight tracking-[0.1em]">
              E-BALIK LOST &amp; FOUND
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45 }}
          className="flex items-center gap-3"
        >
          <button
            onClick={() => setModal("login")}
            className="font-semibold text-white/80 text-[14px] px-4 py-2 rounded-[12px] hover:text-white hover:bg-white/10 transition-colors duration-200"
          >
            Log In
          </button>
          {/* Clay gold register button */}
          <motion.button
            onClick={() => setModal("register")}
            whileHover={{ y: -2, scale: 1.03 }}
            whileTap={{ scale: 0.97, y: 0 }}
            transition={spring}
            className={`${clay.btnGold} text-navy-800 font-bold text-[13px] px-6 py-2.5`}
          >
            Register
          </motion.button>
        </motion.div>
      </header>

      {/* Page body — blurred when modal open */}
      <div className={`flex-1 transition-[filter] duration-300 ${modal !== "none" ? "blur-sm pointer-events-none select-none" : ""}`}>

        {/* ══════════════════════════════════════════════ HERO */}
        <section className="relative bg-[#162448] overflow-hidden min-h-[92vh] flex items-center">

          {/* Floating background blobs */}
          <div className="pointer-events-none absolute inset-0">
            <motion.div
              animate={{ y: [0, -18, 0], rotate: [0, 5, 0] }}
              transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-[8%] right-[6%] w-[320px] h-[320px] rounded-full opacity-20"
              style={{ background: "radial-gradient(circle, #d1a153 0%, transparent 70%)" }}
            />
            <motion.div
              animate={{ y: [0, 14, 0], rotate: [0, -4, 0] }}
              transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
              className="absolute bottom-[12%] left-[4%] w-[280px] h-[280px] rounded-full opacity-15"
              style={{ background: "radial-gradient(circle, #d1a153 0%, transparent 70%)" }}
            />
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: 3 }}
              className="absolute top-[45%] left-[35%] w-[200px] h-[200px] rounded-full opacity-10"
              style={{ background: "radial-gradient(circle, #4a7adf 0%, transparent 70%)" }}
            />
            {/* Dot grid */}
            <div
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.9) 1.5px, transparent 1.5px)`,
                backgroundSize: "36px 36px",
              }}
            />
          </div>

          <div className="relative z-10 flex flex-col gap-10 items-center px-8 md:px-16 py-24 w-full text-center">

            {/* Animated badge */}
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ ...spring, delay: 0.05 }}
              className="flex items-center gap-2.5 bg-white/10 border border-white/20 backdrop-blur-md rounded-full px-5 py-2.5"
            >
              <span className="size-2.5 rounded-full bg-gold-500 animate-pulse shrink-0" />
              <span className="text-white/90 text-[13px] font-semibold tracking-wide">
                Official University of Makati System
              </span>
            </motion.div>

            {/* Clay icon hero blob */}
            <motion.div
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...spring, delay: 0.1 }}
              whileHover={{ scale: 1.08, rotate: 5 }}
              className="flex items-center justify-center rounded-2xl size-[96px] border border-white/20 backdrop-blur-sm bg-navy-800"
            >
              <IconDatabaseSearch />
            </motion.div>

            {/* Heading */}
            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.18 }}
              className="flex flex-col gap-5 items-center max-w-[860px]"
            >
              <h1
                className="font-semibold text-white text-[42px] md:text-[60px] leading-[1.1] tracking-tight"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                E-Balik: Your Smart Campus{" "}
                <span
                  className="text-gold-300 inline-block"
                  style={{ textShadow: "0 0 40px rgba(251,191,36,0.4)" }}
                >
                  Lost &amp; Found
                </span>
              </h1>
              <p className="text-white/65 text-[18px] leading-[30px] max-w-[560px]">
                Report lost items, search found inventory, and get matched automatically with
                the University of Makati's integrated recovery network.
              </p>
            </motion.div>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.26 }}
              className="flex flex-col sm:flex-row gap-4"
            >
              {/* Primary gold clay button */}
              <motion.button
                onClick={() => setModal("login")}
                whileHover={{ y: -4, scale: 1.04 }}
                whileTap={{ scale: 0.97, y: 0 }}
                transition={spring}
                className={`${clay.btnGold} flex gap-3 items-center px-8 py-4`}
              >
                <IconPlusCircle />
                <span className="font-bold text-navy-800 text-[16px]">Report a Lost Item</span>
              </motion.button>

              {/* Ghost white clay button */}
              <motion.button
                onClick={() => setModal("login")}
                whileHover={{ y: -4, scale: 1.04 }}
                whileTap={{ scale: 0.97, y: 0 }}
                transition={spring}
                className="flex gap-3 items-center px-8 py-4 rounded-[16px] border border-white/25 backdrop-blur-md bg-white/10 text-white font-bold text-[16px] hover:bg-white/18 hover:border-white/40 transition-colors duration-200"
              >
                <IconSearchSm />
                <span>Check Found Inventory</span>
              </motion.button>
            </motion.div>

            {/* Trust stats — clay chips */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-4 mt-2"
            >
              {[
                { value: "500+", label: "Items Recovered",  bg: "bg-gold-500", text: "#1f3160" },
                { value: "98%",  label: "Match Accuracy",   bg: "bg-navy-700",  text: "white"   },
                { value: "24/7", label: "System Active",    bg: "bg-gold-500",  text: "#1f3160" },
              ].map(({ value, label, bg, text }, i) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ ...spring, delay: 0.42 + i * 0.08 }}
                  className={`flex flex-col items-center px-7 py-4 rounded-[20px] ${bg}
                              border border-white/25
                              `}
                >
                  <span className="font-bold text-[26px] leading-none" style={{ color: text, fontFamily: "var(--font-heading)" }}>{value}</span>
                  <span className="text-[12px] font-semibold tracking-wide mt-1 uppercase" style={{ color: text, opacity: 0.75 }}>{label}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>

          {/* Wave bottom */}
          <div className="absolute bottom-0 left-0 right-0 overflow-hidden leading-[0]">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 80" preserveAspectRatio="none" className="w-full h-20 block">
              <path fill="#f8fafc" d="M0,40 C360,90 1080,-10 1440,40 L1440,80 L0,80 Z" />
            </svg>
          </div>
        </section>

        {/* ══════════════════════════════════════════════ HOW IT WORKS */}
        <section className="bg-slate-50 flex flex-col gap-14 items-center px-8 md:px-16 pt-24 pb-24 w-full">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            viewport={{ once: true }}
            className="text-center"
          >
            {/* Clay pill label */}
            <span className="mb-3 inline-block text-[12px] font-semibold uppercase tracking-[0.12em] text-gold-700">
              How It Works
            </span>
            <h2
              className="font-semibold text-navy-800 text-[32px] md:text-[36px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Automated Recovery Services
            </h2>
            <p className="text-ink-muted text-[15px] mt-3 max-w-[460px] mx-auto leading-relaxed">
              Three simple steps to reunite students and staff with their belongings.
            </p>
          </motion.div>

          <div className="flex flex-col md:flex-row gap-6 w-full max-w-[1100px]">
            <FeatureCard step="01" icon={<IconLink />}    title="Automated Matching"        color="linear-gradient(135deg,#eef4ff,#dbeafe)" desc="Our system analyzes descriptions and alerts owners automatically when a matching found item is logged." />
            <FeatureCard step="02" icon={<IconSearchLg />} title="Inventory Search"          color="linear-gradient(135deg,#fffbeb,#fef3c7)" desc="Browse real-time categorized logs of found keys, electronics, valuables, and accessories around campus." />
            <FeatureCard step="03" icon={<IconShield />}  title="Secure Pickup Verification" color="linear-gradient(135deg,#ecfdf5,#d1fae5)" desc="Claimed items require verified student or employee ID and signature authentication upon pickup." />
          </div>
        </section>

        {/* ══════════════════════════════════════════════ RECENT ITEMS */}
        <section className="bg-white flex flex-col gap-12 items-center pt-20 pb-28 px-8 md:px-16 w-full border-t border-[#e8edf5]">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            viewport={{ once: true }}
            className="text-center"
          >
            <span className="mb-3 inline-block text-[12px] font-semibold uppercase tracking-[0.12em] text-gold-700">
              Real-Time Logs
            </span>
            <h2
              className="font-semibold text-navy-800 text-[32px] md:text-[36px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Recently Found Items
            </h2>
            <p className="text-ink-muted text-[15px] mt-3 max-w-[480px] mx-auto leading-relaxed">
              These items are currently held at UMak Campus Security — is one yours?
            </p>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full max-w-[1100px]">
            {recentItemsLoading ? Array.from({ length: 4 }, (_, index) => (
              <div key={`recent-skeleton-${index}`} aria-label="Loading recent found items" aria-busy="true" className={`${clay.card} overflow-hidden p-2`}>
                <SkeletonBlock className="h-[160px] rounded-[20px]" />
                <div className="space-y-3 p-4 pt-3">
                  <SkeletonBlock className="h-4 w-3/4" />
                  <SkeletonBlock className="h-3 w-full" />
                  <SkeletonBlock className="h-3 w-1/2" />
                </div>
              </div>
            )) : recentItems.map((item, index) => (
              <motion.div
                key={item.name}
                initial={{ opacity: 0, y: 28, scale: 0.94 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                whileHover={{ y: -8, scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                transition={{ ...spring, opacity: { duration: 0.35 }, delay: index * 0.09 }}
                viewport={{ once: true }}
                onClick={() => setModal("login")}
                className={`${clay.card} overflow-hidden cursor-pointer group`}
              >
                {/* Image area */}
                <div className="h-[160px] relative flex items-center justify-center bg-[#eef2f8] overflow-hidden rounded-[20px] m-2 mb-0">
                  <img
                    alt={item.name}
                    className="size-full object-contain p-3 transition-transform duration-500 group-hover:scale-110"
                    src={item.img}
                  />
                  {/* Clay yellow category badge */}
                  <motion.span
                    whileHover={{ scale: 1.08 }}
                    className="absolute top-3 left-3 text-navy-800 text-[12px] font-bold uppercase px-2.5 py-1.5 tracking-wider rounded-[10px] border border-gold-300 bg-gold-500"
                  >
                    {item.category}
                  </motion.span>
                </div>
                {/* Card body */}
                <div className="flex flex-col gap-2.5 p-4 pt-3">
                  <p className="font-bold text-ink text-[14px] truncate" style={{ fontFamily: "var(--font-heading)" }}>
                    {item.name}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex gap-1.5 items-center">
                      <IconMapPin />
                      <span className="text-ink-muted text-[12px] truncate">{item.location}</span>
                    </div>
                    <div className="flex gap-1.5 items-center">
                      <IconCal />
                      <span className="text-slate-500 text-[12px]">{item.date}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* View All clay CTA */}
          <motion.button
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4, scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            transition={spring}
            viewport={{ once: true }}
            onClick={() => setModal("login")}
            className={`${clay.btn} text-white font-bold text-[15px] px-10 py-4`}
          >
            View All Found Items →
          </motion.button>
        </section>

        {/* ══════════════════════════════════════════════ FOOTER */}
        <footer className="bg-navy-900 flex flex-col w-full">
          {/* Gold→Yellow gradient top border */}
          <div className="h-[4px] w-full bg-[#d1a153]" />

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 px-8 md:px-16 pt-14 pb-10 w-full">
            {/* Clay logo block */}
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center rounded-[16px] size-[56px] bg-navy-800 border border-white/15">
                <img alt="UMak Logo" className="size-[40px] object-contain" src={umakLogo} />
              </div>
              <div>
                <p className="font-bold text-white text-[15px]" style={{ fontFamily: "var(--font-heading)" }}>
                  E-BALIK LOST &amp; FOUND SYSTEM
                </p>
                <p className="text-[#d1a153] text-[13px] mt-0.5">University of Makati — Administrative Office</p>
              </div>
            </div>
            <div className="flex gap-6 flex-wrap">
              {["Privacy Policy", "Terms of Service", "Contact Support"].map((l) => (
                <button key={l} className="text-white/55 text-[13px] hover:text-gold-300 transition-colors duration-200 font-medium">
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="mx-8 md:mx-16 h-px bg-white/10" />
          <p className="text-white/30 text-[12px] px-8 md:px-16 py-6">
            © 2026 University of Makati. All rights reserved. Registered trademark of UM Administrative Systems.
          </p>
        </footer>
      </div>

      {/* ══════════════════════════════════════════════ MODAL OVERLAY */}
      <AnimatePresence>
        {modal !== "none" && (
          <motion.div
            key="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
          >
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-navy-950/55 backdrop-blur-[6px]"
              onClick={() => setModal("none")}
            />

            {/* Modal content with spring entrance */}
            <motion.div
              key={modal}
              initial={{ opacity: 0, scale: 0.88, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={spring}
              className="relative z-10 w-full max-w-[95vw] flex items-center justify-center py-8"
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
    </div>
  );
}
