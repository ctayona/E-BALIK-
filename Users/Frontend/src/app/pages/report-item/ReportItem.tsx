import { ArrowRight, ClipboardPenLine, PackagePlus, Search } from "lucide-react";
import { motion } from "motion/react";
import type { NavigationOptions, Page } from "@/app/types";
import { CX, SPRING } from "@/app/utils/clay";

export default function ReportItem({ onNavigate }: { onNavigate: (page: Page, options?: NavigationOptions) => void }) {
  const cards = [
    {
      page: "found-item" as Page,
      mode: "form",
      icon: <PackagePlus size={28} />,
      iconBg: "bg-navy-800 hover:bg-navy-700",
      iconColor: "text-gold-300",
      title: "I found an item",
      desc: "Record where you found it and document its handover to campus security.",
      cta: "Create found report",
    },
    {
      page: "missing-item" as Page,
      mode: "form",
      icon: <Search size={28} />,
      iconBg: "bg-gold-500 hover:bg-gold-400",
      iconColor: "text-navy-800",
      title: "I lost an item",
      desc: "Describe your missing item and search the found-item records for possible matches.",
      cta: "Create missing report",
    },
  ];

  return (
    <main className={CX.page}>
      <div className="mx-auto max-w-[900px]">

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-10"
        >
          <span className={CX.sectionLabel}>Start a Report</span>
          <h1 className="mt-1 text-[30px] font-semibold text-navy-800 tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
            What happened to the item?
          </h1>
          <p className="mt-1 max-w-[520px] text-[14px] leading-6 text-ink-muted">
            Choose the report that matches your situation. Your account details will be attached automatically.
          </p>
        </motion.div>

        {/* Choice cards */}
        <div className="grid gap-6 md:grid-cols-2">
          {cards.map(({ page, mode, icon, iconBg, iconColor, title, desc, cta }, i) => (
            <motion.button
              key={page}
              type="button"
              onClick={() => onNavigate(page, { mode })}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: i * 0.1 }}
              whileHover={{ y: -8, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`${CX.card} group flex flex-col p-8 text-left cursor-pointer`}
            >
              {/* Icon chip */}
              <div className={`flex size-[60px] items-center justify-center rounded-[20px] ${iconBg} ${iconColor}
                              border border-white/20
                              
                              transition-transform duration-300 group-hover:scale-110`}>
                {icon}
              </div>

              <h2 className="mt-7 text-[22px] font-semibold text-navy-800" style={{ fontFamily: "var(--font-heading)" }}>
                {title}
              </h2>
              <p className="mt-2 text-[14px] leading-6 text-ink-muted flex-1">
                {desc}
              </p>

              <span className="mt-7 inline-flex items-center gap-2 text-[14px] font-bold text-navy-800">
                {cta}
                <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-1.5" />
              </span>
            </motion.button>
          ))}
        </div>

        {/* Footer hint */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
          className={`${CX.cardSm} flex items-center gap-3 p-4 mt-7 text-[13px] text-ink-muted`}
        >
          <ClipboardPenLine size={18} className="shrink-0 text-[#d1a153]" />
          <span>
            Already submitted a report? Open{" "}
            <button
              type="button"
              onClick={() => onNavigate("my-reports")}
              className="font-bold text-navy-800 underline hover:text-[#d1a153] transition-colors"
            >
              My Reports
            </button>{" "}
            to review it.
          </span>
        </motion.div>
      </div>
    </main>
  );
}
