import { useEffect, useState } from "react";
import { ActivityLog, activityLogs as initialLogs } from "../../data/mockData";
import { fetchAdminActivityLogs, fetchAdminAdministratorActivityLogs, getStoredAdmin, reportAdminProcess, type UserActivityLog } from "../../utils/api";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";

type FilterType = "All Types" | "Lost Item" | "Found Item" | "Claim Actions" | "AI Matching" | "Admin & Security";
const FILTER_TABS: FilterType[] = ["All Types", "Lost Item", "Found Item", "Claim Actions", "AI Matching", "Admin & Security"];

const moduleColors: Record<string, { bg: string; text: string }> = {
  "Claims & Verification": { bg: "#eff6ff", text: "#2563eb" },
  "Found Items": { bg: "#ecfdf5", text: "#059669" },
  "Lost Items": { bg: "#f0fdf4", text: "#15803d" },
  "Chain of Custody": { bg: "#fef2f2", text: "#dc2626" },
  "Admin Security": { bg: "#fef3c7", text: "#92400e" },
  Users: { bg: "#eff6ff", text: "#1d4ed8" },
  "AI Matching": { bg: "#f5f3ff", text: "#7c3aed" },
};

const moduleToFilter: Record<string, FilterType> = {
  "Claims & Verification": "Claim Actions",
  "Found Items": "Found Item",
  "Lost Items": "Lost Item",
  "Chain of Custody": "Lost Item",
  "AI Matching": "AI Matching",
  Users: "Admin & Security",
  "Admin Security": "Admin & Security",
};

function mapActivityLogs(data: UserActivityLog[]): ActivityLog[] {
  return data.map((log) => ({
    id: log.id,
    timestamp: new Date(log.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }),
    admin: log.user,
    adminId: log.userId,
    action: log.action,
    module: log.module,
    target: log.target,
    targetId: log.targetId,
    result: log.result,
  }));
}

export default function ActivityLogs() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("All Types");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminLogView, setAdminLogView] = useState(false);
  const isSuperAdmin = getStoredAdmin()?.access_level === "super_admin";

  useEffect(() => {
    let active = true;
    fetchAdminActivityLogs()
      .then((data) => {
        if (!active) return;
        setLogs(mapActivityLogs(data));
      })
      .catch(() => {
        setLogs([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const filtered = logs.filter(l => {
    const q = search.toLowerCase();
    const matchQ = !q || l.action.toLowerCase().includes(q) || l.admin.toLowerCase().includes(q) || l.adminId.toLowerCase().includes(q) || l.id.toLowerCase().includes(q) || l.target.toLowerCase().includes(q) || l.targetId.toLowerCase().includes(q);
    const matchFilter = activeFilter === "All Types" || moduleToFilter[l.module] === activeFilter;
    return matchQ && matchFilter;
  });

  const resultStyle = (r: ActivityLog["result"]) => {
    if (r === "Success") return { bg: "#ecfdf5", text: "#059669", dot: "#10b981" };
    if (r === "Warning") return { bg: "#fffbeb", text: "#d97706", dot: "#f59e0b" };
    return { bg: "#fef2f2", text: "#dc2626", dot: "#ef4444" };
  };

  const toggleAdminLogs = async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    try {
      const data = adminLogView ? await fetchAdminActivityLogs() : await fetchAdminAdministratorActivityLogs();
      setLogs(mapActivityLogs(data));
      setAdminLogView(!adminLogView);
      setActiveFilter("All Types");
      setSearch("");
      reportAdminProcess({
        success: true,
        title: adminLogView ? "User activity logs" : "Administrator activity logs",
        message: `${data.length} audit record${data.length === 1 ? "" : "s"} loaded.`,
      });
    } catch (error) {
      reportAdminProcess({
        success: false,
        title: "Activity logs",
        message: error instanceof Error ? error.message : "Unable to load activity logs.",
      });
    } finally {
      setLoading(false);
    }
  };

  const exportLogs = () => {
    if (filtered.length === 0) {
      reportAdminProcess({ success: false, title: "Export activity logs", message: "There are no matching records to export." });
      return;
    }
    const columns: Array<keyof ActivityLog> = ["id", "timestamp", "admin", "adminId", "action", "module", "target", "targetId", "result"];
    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [columns.join(","), ...filtered.map((log) => columns.map((key) => escapeCsv(String(log[key] ?? ""))).join(","))].join("\r\n");
    const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${adminLogView ? "admin" : "user"}-activity-logs.csv`;
    link.click();
    URL.revokeObjectURL(blobUrl);
    reportAdminProcess({ success: true, title: "Export activity logs", message: `${filtered.length} records exported to CSV.` });
  };

  if (loading) {
    return (
      <div className="p-6 space-y-5" aria-busy="true">
        <div><SkeletonBlock className="mb-2 h-7 w-48" /><SkeletonBlock className="h-4 w-36" /></div>
        <div className="rounded-xl border border-line bg-white p-4 shadow-sm"><SkeletonBlock className="h-10 w-full max-w-md" /></div>
        <AdminTableSkeleton columns={7} rows={7} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Activity Logs</h1>
          <p className="text-sm text-slate-500">{logs.length} {adminLogView ? "administrator" : "user"} audit records</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
        {isSuperAdmin && <button onClick={() => void toggleAdminLogs()} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100">
          {adminLogView ? "View User Logs" : "View Admin / Superadmin Logs"}
        </button>}
        <button onClick={exportLogs} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border border-line rounded-lg hover:bg-navy-50 text-slate-700">
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Export CSV
        </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-2xl border border-line shadow-card p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-52">
          <svg className="absolute left-3 top-2.5 text-slate-400" width="15" height="15" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="m21 21-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search action, admin, item ID..." className="w-full pl-9 pr-3 py-2 text-sm border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-600/20" />
        </div>
        <div className="flex gap-1 flex-wrap">
          {FILTER_TABS.map(tab => (
            <button key={tab} onClick={() => setActiveFilter(tab)}
              className="px-3 py-2 rounded-lg text-xs font-semibold transition-all"
              style={activeFilter === tab ? { background: "#1f3160", color: "white" } : { background: "#f8fafc", color: "#64748b" }}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-line shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {["LOG ID","TIMESTAMP","ADMIN","ACTION","MODULE","TARGET","RESULT",""].map(h => (
                <th key={h} className="text-left px-5 py-4 text-xs font-semibold text-slate-400 tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400">No logs found</td></tr>
            ) : filtered.map(log => {
              const rs = resultStyle(log.result);
              const mc = moduleColors[log.module] ?? { bg: "#f8fafc", text: "#64748b" };
              const isOpen = expanded === log.id;
              const rows = [
                <tr key={log.id} className="border-b border-line hover:bg-navy-50 transition-colors">
                  <td className="px-5 py-4 text-xs font-mono" style={{ color: "#0f8077" }}>{log.id}</td>
                  <td className="px-5 py-4 text-xs text-slate-500 whitespace-nowrap">{log.timestamp}</td>
                  <td className="px-5 py-4">
                    <div className="font-medium text-slate-800">{log.admin}</div>
                    <div className="text-xs text-slate-400">{log.adminId}</div>
                  </td>
                  <td className="px-5 py-4 font-semibold text-slate-900">{log.action}</td>
                  <td className="px-5 py-4">
                    <span className="px-2.5 py-1 rounded-md text-xs font-medium" style={{ background: mc.bg, color: mc.text }}>{log.module}</span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-medium text-slate-800">{log.target}</div>
                    <div className="text-xs text-slate-400">{log.targetId}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: rs.bg, color: rs.text }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: rs.dot }}></span>
                      {log.result}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => setExpanded(isOpen ? null : log.id)} className="text-slate-400 hover:text-slate-600 p-1">
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                        <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </td>
                </tr>,
              ];
              if (isOpen) {
                rows.push(
                  <tr key={`${log.id}-expanded`}>
                    <td colSpan={8} className="px-5 py-3 bg-blue-50 border-b border-blue-100">
                      <div className="text-xs text-blue-800 space-y-1">
                        <div><strong>Full Log Entry:</strong> {log.id}</div>
                        <div><strong>Admin:</strong> {log.admin} ({log.adminId}) performed <strong>{log.action}</strong> on {log.target} ({log.targetId})</div>
                        <div><strong>Module:</strong> {log.module} · <strong>Result:</strong> {log.result} · <strong>Timestamp:</strong> {log.timestamp}</div>
                      </div>
                    </td>
                  </tr>
                );
              }
              return rows;
            })}
          </tbody>
        </table>
        <div className="px-5 py-3 border-t border-line text-sm text-slate-500">
          Showing {filtered.length} of {logs.length} records
        </div>
      </div>
    </div>
  );
}
