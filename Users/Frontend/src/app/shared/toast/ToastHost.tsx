import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { dismissToast, useToasts, type ToastTone } from "./toastStore";

const LOOK: Record<ToastTone, { icon: typeof Info; tone: string }> = {
  success: { icon: CheckCircle2, tone: "text-gold-300" },
  error: { icon: CircleAlert, tone: "text-rose-300" },
  info: { icon: Info, tone: "text-iris-200" },
};

/** Mounted once in App. Sits above the phone's bottom bar and its home-indicator area. */
export default function ToastHost() {
  const toasts = useToasts();
  const reduced = useReducedMotion();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-8"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const { icon: Icon, tone } = LOOK[toast.tone];
          return (
            <motion.div
              key={toast.id}
              layout={!reduced}
              role="status"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
              onClick={() => dismissToast(toast.id)}
              className="pointer-events-auto flex max-w-[min(92vw,420px)] items-center gap-2.5 rounded-2xl border border-white/15 bg-navy-900/95 px-4 py-3 text-[14px] font-medium text-white shadow-[0_18px_40px_-14px_rgba(5,10,30,0.8)] backdrop-blur-xl"
            >
              <Icon size={18} className={`shrink-0 ${tone}`} aria-hidden="true" />
              <span className="min-w-0">{toast.message}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
