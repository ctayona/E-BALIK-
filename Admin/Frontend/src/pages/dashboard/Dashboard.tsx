import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock3, PackageCheck, Sparkles } from "lucide-react";
import { fetchAdminDashboard, type AdminDashboardSummary } from "../../utils/api";
import { AdminMetricSkeleton, SkeletonBlock, AdminTableSkeleton } from "../../components/LoadingSkeleton";

interface DonutProps { value: number; color: string; size?: number; }
function Donut({ value, color, size = 110 }: DonutProps) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const filled = (value / 100) * circ;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#f0f2f7" strokeWidth="9" />
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

export default function Dashboard() {
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityFilter, setActivityFilter] = useState<string>("All");

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
    if (!value) return "Unknown time";
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

    if (!target || target === "-" || target === "N/A") return "Item record";

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
    return cleaned || "Item record";
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

  const stats = [
    { label: "Total Lost Reports", value: summary?.total_lost_reports ?? 0, delta: "+live", icon: <ClipboardList size={18} strokeWidth={2.2} aria-hidden="true" />, color: "#1f3160", bg: "#f2f5fb" },
    { label: "Found Items", value: summary?.found_items ?? 0, delta: "+live", icon: <PackageCheck size={18} strokeWidth={2.2} aria-hidden="true" />, color: "#0f8077", bg: "#ecfaf8" },
    { label: "Potential AI Matches", value: summary?.potential_ai_matches ?? 0, delta: "+live", icon: <Sparkles size={18} strokeWidth={2.2} aria-hidden="true" />, color: "#8f6526", bg: "#fdf8ee" },
    { label: "Pending Claims", value: summary?.pending_claims ?? 0, delta: "live", icon: <Clock3 size={18} strokeWidth={2.2} aria-hidden="true" />, color: "#b45309", bg: "#fffbeb" },
    { label: "Successfully Returned", value: summary?.successfully_returned ?? 0, delta: "+live", icon: <CheckCircle2 size={18} strokeWidth={2.2} aria-hidden="true" />, color: "#047857", bg: "#ecfdf5" },
    { label: "Unresolved Items", value: summary?.unresolved_items ?? 0, delta: "live", icon: <AlertTriangle size={18} strokeWidth={2.2} aria-hidden="true" />, color: "#be123c", bg: "#fff1f2" },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="admin-metric group">
            <div className="flex items-center justify-between mb-3">
              <div className="flex size-10 items-center justify-center rounded-xl" style={{ background: s.bg, color: s.color }}>
                {s.icon}
              </div>
              <span className="text-[12px] font-bold uppercase tracking-wider opacity-80" style={{ color: s.color }}>{s.delta}</span>
            </div>
            <div className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-none tabular-nums text-ink">{s.value}</div>
            <div className="text-[12px] text-slate-500 mt-1.5 font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Bar chart */}
        <div className="xl:col-span-2 rounded-2xl border border-line bg-white p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-bold text-slate-900 text-[15px]">Lost vs Found Items</div>
              <div className="text-[12px] text-slate-400 mt-0.5">Monthly comparison — trailing 12 months</div>
            </div>
            <div className="flex items-center gap-4 text-[12px] font-medium">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#1f3160" }}></span> Lost</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#0f8077" }}></span> Found</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barCategoryGap="35%" barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
              <Tooltip contentStyle={{ border: "1px solid #e8ecf3", borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.06)", fontSize: 13 }} />
              <Bar dataKey="lost" fill="#1f3160" radius={[5, 5, 0, 0]} />
              <Bar dataKey="found" fill="#0f8077" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* System performance */}
        <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
          <div className="font-bold text-slate-900 text-[15px] mb-0.5">System Performance</div>
          <div className="text-[12px] text-slate-400 mb-4">Current period metrics</div>
          <div className="flex justify-around mb-5">
            <div className="text-center">
              <Donut value={recoveryRate} color="#0f8077" size={100} />
              <div className="text-[12px] text-slate-600 mt-1.5 font-semibold">Recovery Rate</div>
            </div>
            <div className="text-center">
              <Donut value={aiDecisionAcceptance} color="#7c3aed" size={100} />
              <div className="text-[12px] text-slate-600 mt-1.5 font-semibold">AI Acceptance</div>
            </div>
          </div>
          <div className="space-y-2.5 text-[13px] border-t border-line pt-4">
            <div className="flex justify-between"><span className="text-slate-500">Avg. Resolution Time</span><span className="font-semibold text-slate-800">{summary?.average_resolution_days == null ? "N/A" : `${summary.average_resolution_days} days`}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">This Month</span><span className="font-semibold text-slate-800">{summary?.current_month_processed ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">AI Confirmed</span><span className="font-semibold text-slate-800">{summary?.ai_confirmed ?? 0} / {summary?.ai_decided ?? 0}</span></div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-bold text-slate-900 text-[15px]">Recent Activity</div>
            <div className="text-[12px] text-slate-400 mt-0.5">Latest system events</div>
          </div>
        </div>
        {activityCategories.length > 1 && (
          <div className="mb-4 flex gap-1.5 flex-wrap">
            {activityCategories.map(cat => (
              <button
                key={cat}
                onClick={() => setActivityFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  activityFilter === cat
                    ? "bg-navy-800 text-white "
                    : "bg-slate-50 text-slate-500 hover:bg-[#ebeef4] hover:text-slate-700"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {recentActivity.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-8 bg-slate-50 rounded-xl">No activities yet</div>
          ) : (
            recentActivity.map((a) => {
              const colors: Record<string, string> = { success: "#10b981", ai: "#7c3aed", item: "#3b82f6", warning: "#f59e0b", error: "#ef4444" };
              const bg: Record<string, string> = { success: "#f0fdf4", ai: "#faf5ff", item: "#f0f6ff", warning: "#fffbeb", error: "#fef2f2" };
              return (
                <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl transition-colors" style={{ background: bg[a.type] }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colors[a.type] }}></div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-[13px] text-slate-800">{a.action}</span>
                    <span className="text-[13px] text-slate-500"> — {a.detail}</span>
                  </div>
                  <div className="text-[12px] text-slate-400 flex-shrink-0 font-medium">{a.time}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
