import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Clock3, Gavel, Sparkles } from "lucide-react";
import { fetchAdminDashboard, getStoredAdmin, type AdminDashboardSummary } from "../../utils/api";
import { RolePill } from "../../components/ui/primitives";
import { fetchAdminAuctions } from "../../utils/auctionApi";
import { isSuperAdmin } from "../../utils/permissions";
import { useTheme, tr } from "../../utils/preferences";

type DeskPage = "claims" | "ai-matching" | "lost-items" | "found-items" | "users" | "activity-logs" | "auctions";
import { AdminMetricSkeleton, SkeletonBlock, AdminTableSkeleton } from "../../components/LoadingSkeleton";
import AnalyticsSection from "./AnalyticsSection";
import HandoverPinCard from "./HandoverPinCard";

interface DonutProps { value: number; color: string; size?: number; }
function Donut({ value, color, size = 110 }: DonutProps) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const filled = (value / 100) * circ;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" style={{ stroke: "var(--color-line-strong)" }} strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9"
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="700" fill={color}>{value}%</text>
    </svg>
  );
}

export default function Dashboard({ onNavigate }: { onNavigate?: (page: DeskPage) => void }) {
  const [theme] = useTheme();
  const dark = theme === "dark";
  const chart = dark
    ? { grid: "rgba(255,255,255,0.06)", tick: "#8f9cb8", cursor: "rgba(209,161,83,0.08)", lost: "#8ea4e6", tooltip: { background: "#0f172f", border: "1px solid rgba(255,255,255,0.1)", color: "#eef1f8" } }
    : { grid: "#eef1f6", tick: "#5b6b82", cursor: "rgba(31,49,96,0.05)", lost: "#1f3160", tooltip: { background: "#ffffff", border: "1px solid #e3e8f0", color: "#0f172a" } };
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityFilter, setActivityFilter] = useState<string>("All");
  // Auction pickups join the work queue once the Auction Hall tables exist; any failure just hides the row.
  const [auctionPickups, setAuctionPickups] = useState<number | null>(null);
  const [auctionDecisions, setAuctionDecisions] = useState<number | null>(null);
  const [reauctionReady, setReauctionReady] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetchAdminAuctions().then((data) => { if (active) { setAuctionPickups(data.stats.awaiting_pickup); setAuctionDecisions(data.stats.awaiting_admin ?? 0); setReauctionReady(data.stats.reauction_ready ?? 0); } }).catch(() => { if (active) { setAuctionPickups(null); setAuctionDecisions(null); setReauctionReady(null); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetchAdminDashboard()
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch(() => {
        if (active) setSummary(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const chartData = summary?.chart_data?.length ? summary.chart_data : [];
  const recoveryRate = Math.min(100, Math.max(0, summary?.recovery_rate ?? 0));
  const aiDecisionAcceptance = summary?.ai_decided
    ? Math.min(100, Math.max(0, ((summary.ai_confirmed ?? 0) / summary.ai_decided) * 100))
    : 0;

  const getActivityType = (action: string, module: string): string => {
    const lower = action.toLowerCase() + " " + module.toLowerCase();
    if (lower.includes("claim")) return "Claims";
    if (lower.includes("missing")) return "Lost Items";
    if (lower.includes("found")) return "Found Items";
    if (lower.includes("match")) return "AI Matching";
    return "Other";
  };

  const formatActivityTimestamp = (value?: string) => {
    if (!value) return tr("Unknown time");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  };

  const sanitizeActivityTarget = (target?: string, targetId?: string) => {
    const candidateValues = [targetId, target].filter((value): value is string => Boolean(value) && value !== "-" && value !== "N/A");
    const itemCodePattern = /(EB-[LF]-\d{4}-\d{3}|EB\s*-\s*[LF]-\d{4}-\d{3}|(?:MP|FP)\d{3,})/gi;

    const extractedCodes = candidateValues
      .flatMap((value) => Array.from(value.matchAll(itemCodePattern), (match) => match[0]))
      .map((value) => value.replace(/\s+/g, ""))
      .filter((value) => value && value !== "-" && value !== "N/A");

    if (extractedCodes.length > 0) {
      return [...new Set(extractedCodes)].join(" ↔ ");
    }

    if (!target || target === "-" || target === "N/A") return tr("Item record");

    const rawTarget = target.replace(/\s*—\s*.*$/, "").replace(/\s*↔\s*.*$/, "").trim();
    if (rawTarget && rawTarget !== "Item record") {
      return rawTarget;
    }

    const cleaned = target
      .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "")
      .replace(/\s*↔\s*$/, "")
      .replace(/\s*↔\s*/g, " ↔ ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return cleaned || tr("Item record");
  };

  const formatActivityDetail = (log: NonNullable<AdminDashboardSummary["recent_activity"]>[number]) => {
    const user = log.user || "System";
    if (getActivityType(log.action, log.module) !== "Claims") {
      return `${sanitizeActivityTarget(log.target, log.targetId)} — ${user}`;
    }

    const itemCode = sanitizeActivityTarget(log.targetId, log.targetId);
    const targetParts = (log.target || "Item").split(/\s*—\s*/);
    const itemName = (targetParts.length > 1 ? targetParts.slice(1).join(" — ") : targetParts[0])
      .replace(/\s*↔\s*.*$/, "")
      .trim();
    const displayName = itemName && itemName !== "-" && itemName !== "N/A" && itemName !== "Item record"
      ? itemName
      : "Item";
    return itemCode !== "Item record"
      ? `${displayName} — ${itemCode} — ${user}`
      : `${displayName} — ${user}`;
  };

  const allActivities = (summary?.recent_activity ?? []).map((log) => ({
    id: log.id,
    action: log.action,
    detail: formatActivityDetail(log),
    time: formatActivityTimestamp(log.timestamp),
    type: log.result === "Error" ? "error" : log.result === "Warning" ? "warning" : log.action.toLowerCase().includes("match") ? "ai" : log.module.toLowerCase().includes("claim") ? "success" : "item",
    category: getActivityType(log.action, log.module),
  }));

  const activityCategories = ["All", "Claims", "Lost Items", "Found Items", "AI Matching"];

  const filteredActivities = activityFilter === "All"
    ? allActivities
    : allActivities.filter(a => a.category === activityFilter);

  const recentActivity = filteredActivities.slice(0, 5);

  if (loading) {
    return (
      <div className="p-4 space-y-6 sm:p-6" aria-busy="true">
        <div><SkeletonBlock className="mb-2 h-7 w-52" /><SkeletonBlock className="h-4 w-72" /></div>
        <AdminMetricSkeleton count={6} />
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-line bg-white p-5 xl:col-span-2"><SkeletonBlock className="mb-5 h-4 w-48" /><SkeletonBlock className="h-[220px] w-full" /></div>
          <div className="rounded-2xl border border-line bg-white p-5"><SkeletonBlock className="mb-5 h-4 w-40" /><SkeletonBlock className="h-[220px] w-full rounded-full" /></div>
        </div>
        <AdminTableSkeleton columns={4} rows={4} />
      </div>
    );
  }

  const admin = getStoredAdmin();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? tr("Good morning") : hour < 18 ? tr("Good afternoon") : tr("Good evening");
  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  const queue: { label: string; hint: string; value: number; page: DeskPage; edge: string; icon: JSX.Element }[] = [
    { label: tr("Claims waiting for review"), hint: tr("Check proof and ID, then approve or reject"), value: summary?.pending_claims ?? 0, page: "claims", edge: "before:bg-gold-500", icon: <Clock3 size={18} aria-hidden="true" /> },
    { label: tr("AI matches to confirm"), hint: tr("Possible owner and item pairs found automatically"), value: summary?.potential_ai_matches ?? 0, page: "ai-matching", edge: "before:bg-iris-500", icon: <Sparkles size={18} aria-hidden="true" /> },
    { label: tr("Unresolved items"), hint: tr("Reports still open without a match or claim"), value: summary?.unresolved_items ?? 0, page: "lost-items", edge: "before:bg-rose-400", icon: <AlertTriangle size={18} aria-hidden="true" /> },
    ...(auctionDecisions ? [{ label: tr("Auctions awaiting your decision"), hint: tr("Bidding closed. Confirm the winner or re-auction"), value: auctionDecisions, page: "auctions" as DeskPage, edge: "before:bg-iris-400", icon: <Gavel size={18} aria-hidden="true" /> }] : []),
    ...(reauctionReady ? [{ label: tr("Ready for re-auction"), hint: tr("The winner did not collect in 72 hours. List the item again"), value: reauctionReady, page: "auctions" as DeskPage, edge: "before:bg-rose-400", icon: <Gavel size={18} aria-hidden="true" /> }] : []),
    ...(auctionPickups ? [{ label: tr("Auction pickups waiting"), hint: tr("Winners who still need to pay and collect"), value: auctionPickups, page: "auctions" as DeskPage, edge: "before:bg-gold-300", icon: <Gavel size={18} aria-hidden="true" /> }] : []),
  ];
  const openItems = queue.reduce((total, item) => total + item.value, 0);

  const inventory = [
    { label: tr("Lost reports"), value: summary?.total_lost_reports ?? 0, page: "lost-items" as DeskPage },
    { label: tr("Found items in custody"), value: summary?.found_items ?? 0, page: "found-items" as DeskPage },
    { label: tr("Returned to owners"), value: summary?.successfully_returned ?? 0, page: "claims" as DeskPage },
    { label: tr("Registered users"), value: summary?.total_users ?? 0, page: "users" as DeskPage },
  ];

  const activityTone: Record<string, string> = {
    success: "border-l-tide-500", ai: "border-l-iris-500", item: "border-l-navy-400", warning: "border-l-amber-500", error: "border-l-rose-500",
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* The desk: today's work queue is the first thing an officer sees */}
      <section className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#22366a_0%,#162448_55%,#0e1830_100%)] text-white shadow-raised dark:shadow-[0_0_0_1px_rgba(209,161,83,0.18),0_30px_80px_-30px_rgba(209,161,83,0.35)]" aria-labelledby="desk-heading">
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-gold-500/15 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 size-80 rounded-full bg-iris-500/15 blur-3xl" aria-hidden="true" />
        <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-center">
          <div>
            <p className="text-[14px] text-navy-200">{today}</p>
            <h1 id="desk-heading" className="mt-1 font-[family-name:var(--font-heading)] text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[38px]">
              {greeting}, {admin?.fname || tr("officer")}.
            </h1>
            <p className="mt-3 max-w-[44ch] text-[15px] leading-7 text-navy-100">
              {openItems === 0
                ? tr("The desk is clear. Nothing is waiting on you right now.")
                : tr("{0} {1} your attention across claims, matches and open reports.", { "0": openItems, "1": openItems === 1 ? tr("thing needs") : tr("things need") })}
            </p>
            <div className="mt-4"><RolePill superAdmin={isSuperAdmin()} /></div>
          </div>

          <div className="rounded-[22px] border border-white/12 bg-white/[0.06] p-2 backdrop-blur-md">
            <p className="px-3 pb-1 pt-2 text-[13px] font-semibold text-gold-200">{tr("Needs your action")}</p>
            <ul className="space-y-1.5">
              {queue.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={() => onNavigate?.(item.page)}
                    className={`group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl bg-white/[0.04] px-4 py-3.5 text-left transition-colors hover:bg-white/[0.1] before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full ${item.edge}`}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-gold-200">{item.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold">{item.label}</span>
                      <span className="block truncate text-[13px] text-navy-200">{item.hint}</span>
                    </span>
                    <span className={`font-[family-name:var(--font-heading)] text-[28px] font-semibold tabular-nums ${item.value > 0 ? "text-white" : "text-navy-300"}`}>{item.value}</span>
                    <ChevronRight size={18} className="shrink-0 text-navy-300 transition-transform group-hover:translate-x-0.5 group-hover:text-white" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <HandoverPinCard />

      {/* Inventory at a glance: one quiet panel rather than a wall of identical cards */}
      <section className="admin-card overflow-hidden" aria-label={tr("Inventory")}>
        <dl className="grid grid-cols-2 divide-line lg:grid-cols-4 [&>*]:border-line max-lg:[&>*:nth-child(-n+2)]:border-b lg:divide-x max-lg:[&>*:nth-child(odd)]:border-r">
          {inventory.map((stat) => (
            <button key={stat.label} type="button" onClick={() => onNavigate?.(stat.page)} className="group px-5 py-4 text-left transition-colors hover:bg-frost-50 sm:px-6 sm:py-5">
              <dt className="text-[13px] font-medium text-ink-muted group-hover:text-navy-700">{stat.label}</dt>
              <dd className="mt-1 font-[family-name:var(--font-heading)] text-[28px] font-semibold leading-none tabular-nums text-ink">{stat.value.toLocaleString()}</dd>
            </button>
          ))}
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <section className="admin-card p-5 sm:p-6 xl:col-span-2" aria-labelledby="trend-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="trend-heading" className="font-[family-name:var(--font-heading)] text-[18px] font-semibold text-ink">{tr("Lost and found, month by month")}</h2>
              <p className="text-[13px] text-ink-muted">{tr("Reports filed over the last 12 months")}</p>
            </div>
            <div className="flex items-center gap-4 text-[13px] font-medium text-ink-soft">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-navy-800 dark:bg-[#8ea4e6]" aria-hidden="true" />{tr("Lost")}</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-gold-500" aria-hidden="true" />{tr("Found")}</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} barCategoryGap="32%" barGap={4}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: chart.tick }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: chart.tick }} allowDecimals={false} />
              <Tooltip cursor={{ fill: chart.cursor }} labelStyle={{ color: chart.tooltip.color }} contentStyle={{ ...chart.tooltip, borderRadius: 14, boxShadow: "0 12px 32px -12px rgba(17,27,66,0.25)", fontSize: 13 }} />
              <Bar dataKey="lost" name="Lost" fill={chart.lost} radius={[6, 6, 0, 0]} />
              <Bar dataKey="found" name="Found" fill="#d1a153" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="admin-card p-5 sm:p-6" aria-labelledby="performance-heading">
          <h2 id="performance-heading" className="font-[family-name:var(--font-heading)] text-[18px] font-semibold text-ink">{tr("How the desk is doing")}</h2>
          <p className="mb-5 text-[13px] text-ink-muted">{tr("This period")}</p>
          <div className="mb-5 flex justify-around">
            <div className="text-center">
              <Donut value={recoveryRate} color="#23977c" size={104} />
              <div className="mt-1.5 text-[13px] font-semibold text-ink-soft">{tr("Items returned")}</div>
            </div>
            <div className="text-center">
              <Donut value={Math.round(aiDecisionAcceptance)} color="#5470d6" size={104} />
              <div className="mt-1.5 text-[13px] font-semibold text-ink-soft">{tr("AI matches accepted")}</div>
            </div>
          </div>
          <dl className="space-y-2.5 border-t border-line pt-4 text-[14px]">
            <div className="flex justify-between"><dt className="text-ink-muted">{tr("Average time to resolve")}</dt><dd className="font-semibold tabular-nums text-ink">{summary?.average_resolution_days == null ? tr("Not enough data") : tr("{0} days", { "0": summary.average_resolution_days })}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-muted">{tr("Processed this month")}</dt><dd className="font-semibold tabular-nums text-ink">{summary?.current_month_processed ?? 0}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-muted">{tr("AI decisions confirmed")}</dt><dd className="font-semibold tabular-nums text-ink">{summary?.ai_confirmed ?? 0} of {summary?.ai_decided ?? 0}</dd></div>
          </dl>
        </section>
      </div>

      <AnalyticsSection />

      <section className="admin-card p-5 sm:p-6" aria-labelledby="activity-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="activity-heading" className="font-[family-name:var(--font-heading)] text-[18px] font-semibold text-ink">{tr("Recent activity")}</h2>
            <p className="text-[13px] text-ink-muted">{tr("The latest changes made across the system")}</p>
          </div>
          <button type="button" onClick={() => onNavigate?.("activity-logs")} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[14px] font-semibold text-iris-700 hover:bg-iris-50">
            {tr("All activity")} <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
        <div role="tablist" aria-label={tr("Filter activity")} className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border border-line bg-frost-50 p-1">
          {activityCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={activityFilter === cat}
              onClick={() => setActivityFilter(cat)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${activityFilter === cat ? "bg-white text-navy-800 shadow-card" : "text-ink-muted hover:text-navy-800"}`}
            >
              {tr(cat)}
            </button>
          ))}
        </div>
        {recentActivity.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center text-[14px] text-ink-muted">{tr("No activity in this category yet. Actions taken by admins and users will appear here.")}</p>
        ) : (
          <ul className="space-y-2">
            {recentActivity.map((a) => (
              <li key={a.id} className={`flex flex-col gap-1 rounded-xl border border-line border-l-4 bg-white px-4 py-3 sm:flex-row sm:items-center sm:gap-4 ${activityTone[a.type] ?? "border-l-navy-300"}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-ink">{a.action}</p>
                  <p className="truncate text-[13px] text-ink-muted">{a.detail}</p>
                </div>
                <time className="shrink-0 text-[13px] tabular-nums text-ink-muted">{a.time}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
