import { useEffect, useState } from "react";
import { fetchAdminAIMatches, confirmAdminAIMatch, rejectAdminAIMatch, type AdminAIMatchRow } from "../../utils/api";
import { AdminCardGridSkeleton } from "../../components/LoadingSkeleton";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { showInfoModal } from "../../components/info-modal/infoModalStore";
import { T } from "../../components/ui/management";

import { tr } from "../../utils/preferences";
type MatchStatus = "All Matches" | "High Confidence" | "Needs Review" | "Confirmed" | "Rejected";

const TABS: MatchStatus[] = ["All Matches", "High Confidence", "Needs Review", "Confirmed", "Rejected"];

function MatchBar({ label, value }: { label: string; value: number }) {
  const color = value >= 90 ? "#10b981" : value >= 75 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-500 w-32 text-xs">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold w-8 text-right" style={{ color }}>{value}%</span>
    </div>
  );
}

function formatMatchTimestamp(value?: string) {
  if (!value) return tr("No timestamp");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function ItemVisual({ image, label, onClick }: { image?: string; label: string; onClick?: () => void }) {
  const hasImage = Boolean(image && image.trim());

  if (!hasImage) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded-xl border border-dashed border-line bg-slate-50 text-slate-300">
        <svg width="40" height="40" fill="none" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
          <path d="m21 15-5-5L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} className="block h-28 w-full overflow-hidden rounded-xl border border-line bg-slate-50 shadow-sm transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-violet-300">
      <img decoding="async" src={image} alt={label} className="h-full w-full object-contain p-2" />
    </button>
  );
}

export default function AIMatching() {
  const [matches, setMatches] = useState<AdminAIMatchRow[]>([]);
  const [activeTab, setActiveTab] = useState<MatchStatus>("All Matches");
  const [loading, setLoading] = useState(true);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; label: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ id: string; action: "confirm" | "reject" } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchAdminAIMatches()
      .then(data => {
        if (!active) return;
        setMatches(data);
      })
      .catch(() => {
        setMatches([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const counts: Record<string, number> = {
    "All Matches": matches.length,
    "High Confidence": matches.filter(m => m.status === "High Confidence").length,
    "Needs Review": matches.filter(m => m.status === "Needs Review").length,
    "Confirmed": matches.filter(m => m.status === "Confirmed").length,
    "Rejected": matches.filter(m => m.status === "Rejected").length,
  };

  const filtered = activeTab === "All Matches" ? matches : matches.filter(m => m.status === activeTab);

  const confirmPendingAction = async () => {
    if (!pendingAction || actionBusy) return;
    const match = matches.find((entry) => entry.id === pendingAction.id);
    if (!match) return;
    setActionBusy(true);
    try {
      if (pendingAction.action === "confirm") {
        await confirmAdminAIMatch(match.lostId, match.foundId);
        setMatches((current) => current.map((entry) => entry.id === match.id ? { ...entry, status: "Confirmed" } : entry));
      } else {
        await rejectAdminAIMatch(match.lostId, match.foundId);
        setMatches((current) => current.map((entry) => entry.id === match.id ? { ...entry, status: "Rejected" } : entry));
      }
      setPendingAction(null);
    } catch (error) {
      showInfoModal({ variant: "error", title: "AI match not updated", message: error instanceof Error ? error.message : "Unable to update the AI match.", replaceAuto: true });
      setPendingAction(null);
    } finally {
      setActionBusy(false);
    }
  };

  const statusStyle = (s: string) => {
    if (s === "High Confidence") return { bg: "#f0fdf4", text: "#166534", border: "#bbf7d0" };
    if (s === "Needs Review") return { bg: "#fffbeb", text: "#92400e", border: "#fde68a" };
    if (s === "Confirmed") return { bg: "#eff6ff", text: "#1e40af", border: "#bfdbfe" };
    return { bg: "#fef2f2", text: "#991b1b", border: "#fecaca" };
  };

  const totalMatches = matches.length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]"><T k="page.aiMatching" /></h1>
        
      </div>

      <div className="bg-white rounded-2xl border border-line shadow-card p-1.5 flex gap-1 w-fit max-w-full overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="shrink-0 whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform]"
            style={activeTab === tab ? { background: "#1f3160", color: "white" } : { color: "#6b7280" }}
          >
            {tr(tab)} <span className="ml-1 opacity-70">{counts[tab]}</span>
          </button>
        ))}
      </div>

      {zoomedImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setZoomedImage(null)}>
          <div className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-2xl bg-white p-3 shadow-2xl" onClick={e => e.stopPropagation()}>
            <button type="button" onClick={() => setZoomedImage(null)} className="absolute right-4 top-4 z-10 rounded-full bg-white/90 p-2 text-slate-700 shadow-sm hover:bg-white">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
            <img decoding="async" src={zoomedImage.src} alt={zoomedImage.label} className="max-h-[80vh] max-w-[80vw] rounded-xl object-contain" />
            <div className="mt-3 text-center text-sm font-medium text-slate-700">{zoomedImage.label}</div>
          </div>
        </div>
      )}

      {loading ? (
        <AdminCardGridSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filtered.length === 0 ? (
            <div className="col-span-2 text-center py-16 text-slate-400">{tr("No matches in this category")}</div>
          ) : filtered.map(match => {
            const ss = statusStyle(match.status);
            const isPending = match.status === "Needs Review" || match.status === "High Confidence";
            return (
              <div key={match.id} className="bg-white rounded-2xl border border-line shadow-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-mono text-slate-400">{match.id}</span>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full border" style={{ background: ss.bg, color: ss.text, borderColor: ss.border }}>
                      {match.status}
                    </span>
                    {(match.status === "Confirmed" || match.status === "Rejected") && (
                      <span className="text-[12px] text-slate-500">
                        {formatMatchTimestamp(match.timestamp)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-2 items-center mb-5">
                  <div className="col-span-2">
                    <div className="text-xs font-bold mb-2" style={{ color: "#ef4444" }}>{tr("Lost item")}</div>
                    <div className="mb-2">
                      <ItemVisual image={match.lostImage} label={match.lostItem} onClick={() => match.lostImage && setZoomedImage({ src: match.lostImage, label: match.lostItem })} />
                    </div>
                    <div className="font-semibold text-slate-900 text-sm">{match.lostItem}</div>
                    <div className="text-xs text-slate-400">{match.lostDesc}</div>
                    <div className="text-xs text-slate-400">{match.lostLocation}</div>
                    <div className="text-xs text-slate-400">{tr("Reported {0}", { "0": match.lostDate })}</div>
                    <div className="text-xs font-mono mt-1" style={{ color: "#0f8077" }}>{match.lostId}</div>
                  </div>

                  <div className="flex flex-col items-center justify-center gap-1">
                    <span className="text-slate-300 text-xs font-semibold">{tr("VS")}</span>
                    <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center border-2" style={{ borderColor: match.matchPercent >= 85 ? "#10b981" : "#f59e0b", background: "#f0fdf4" }}>
                      <span className="text-lg font-black" style={{ color: match.matchPercent >= 85 ? "#10b981" : "#f59e0b" }}>{match.matchPercent}%</span>
                      <span className="text-xs text-slate-400">{tr("Match")}</span>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <div className="text-xs font-bold mb-2" style={{ color: "#0f8077" }}>{tr("Found item")}</div>
                    <div className="mb-2">
                      <ItemVisual image={match.foundImage} label={match.foundItem} onClick={() => match.foundImage && setZoomedImage({ src: match.foundImage, label: match.foundItem })} />
                    </div>
                    <div className="font-semibold text-slate-900 text-sm">{match.foundItem}</div>
                    <div className="text-xs text-slate-400">{match.foundDesc}</div>
                    <div className="text-xs text-slate-400">{match.foundLocation}</div>
                    <div className="text-xs text-slate-400">{tr("Found {0}", { "0": match.foundDate })}</div>
                    <div className="text-xs font-mono mt-1" style={{ color: "#0f8077" }}>{match.foundId}</div>
                  </div>
                </div>

                <div className="border-t border-line pt-4 space-y-2">
                  <div className="text-xs font-bold text-slate-400 mb-2">{tr("Match Analysis")}</div>
                  <MatchBar label={tr("Visual Similarity")} value={match.visualSim} />
                  <MatchBar label={tr("Description Match")} value={match.descSim} />
                  <MatchBar label={tr("Location Match")} value={match.locationSim} />
                  <MatchBar label={tr("Time Proximity")} value={match.timeSim} />
                </div>

                {isPending && (
                  <div className="flex gap-3 mt-4 pt-4 border-t border-line">
                    <button onClick={() => setPendingAction({ id: match.id, action: "reject" })} className="flex-1 py-2 rounded-lg text-sm font-semibold border border-line text-slate-600 hover:bg-navy-50 transition-colors">
                      {tr("Reject Match")}
                    </button>
                    <button onClick={() => setPendingAction({ id: match.id, action: "confirm" })} className="flex-1 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "#0f8077" }}>
                      {tr("Confirm Match")}
                    </button>
                  </div>
                )}
                {match.status === "Confirmed" && (
                  <div className="mt-4 pt-4 border-t border-line flex items-center justify-center gap-2 text-sm text-emerald-600 font-semibold">
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {tr("Match Confirmed")}
                  </div>
                )}
                {match.status === "Rejected" && (
                  <div className="mt-4 pt-4 border-t border-line flex items-center justify-center gap-2 text-sm text-red-500 font-semibold">
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    {tr("Match Rejected")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {pendingAction && <ConfirmActionDialog
        title={pendingAction.action === "confirm" ? tr("confirm this AI match") : tr("reject this AI match")}
        description={tr("This decision updates the shared match record and may notify users.")}
        confirmLabel={pendingAction.action === "confirm" ? tr("Confirm match") : tr("Reject match")}
        danger={pendingAction.action === "reject"}
        busy={actionBusy}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />}
    </div>
  );
}
