import { useEffect, useState } from "react";
import { Archive, ClipboardList, Link2, MapPin, Sparkles } from "lucide-react";
import { fetchAdminClaims, fetchAdminFoundItems, reportAdminProcess, type AdminClaimRow, type AdminFoundItemRow } from "../../utils/api";
import { AdminCardGridSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import { T } from "../../components/ui/management";

import { tr } from "../../utils/preferences";
type FoundItemLike = {
  id: string;
  item: string;
  description: string;
  category: string;
  locationFound: string;
  dateFound: string;
  guardName?: string;
  createdAt?: string;
  storage: string;
  aiStatus: string;
  aiPercent: number | null;
  matchedItem?: string;
  status: "Ready to Release" | "Under Review" | "Released" | "Claimed" | "Unclaimed";
  photo?: string;
};

function formatDateTime(value?: string): string {
  if (!value) return tr("Date unavailable");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

type CustodyEvent = { type: string; label: string; date: string; actor: string; desc: string; color: string };
type CustodyRecord = { id: string; events: CustodyEvent[] };

function getEventLabel(type: string): string {
  const labels: Record<string, string> = {
    FOUND: "Found",
    REGISTERED: "Registered",
    AI_MATCHED: "AI Matched",
    CLAIM_SUBMITTED: "Claim Submitted",
    VERIFIED: "Claim Verified",
    RELEASED: "Released",
  };

  return labels[type] || type;
}

function buildCustodyTimeline(item: FoundItemLike, claim?: AdminClaimRow): CustodyRecord {
  const events: CustodyEvent[] = [
    {
      type: "FOUND",
      label: getEventLabel("FOUND"),
      date: formatDateTime(item.createdAt || item.dateFound),
      actor: tr("Found item reporter"),
      desc: tr("Item was found at {0}.", { "0": item.locationFound || tr("an unknown location") }),
      color: "#0f8077",
    },
    {
      type: "REGISTERED",
      label: getEventLabel("REGISTERED"),
      date: formatDateTime(item.createdAt || item.dateFound),
      actor: item.guardName ? tr("Guard: {0}", { "0": item.guardName }) : tr("Admin system"),
      desc: `Item registered in E-Balik and stored in ${item.storage || tr("secure inventory")}.${item.guardName ? ` Received by guard ${item.guardName}.` : ""}`,
      color: "#3b82f6",
    },
  ];

  if (item.aiPercent !== null && item.aiPercent !== undefined) {
    events.push({
      type: "AI_MATCHED",
      label: getEventLabel("AI_MATCHED"),
      date: formatDateTime(item.createdAt || item.dateFound),
      actor: tr("AI Engine"),
      desc: tr("Potential match detected with {0}% confidence.", { "0": item.aiPercent }),
      color: "#7c3aed",
    });
  }

  if (claim) {
    events.push({
      type: "CLAIM_SUBMITTED",
      label: getEventLabel("CLAIM_SUBMITTED"),
      date: formatDateTime(claim.submittedAt || claim.submitted),
      actor: `${claim.claimant} (${claim.studentId})`,
      desc: claim.claimReason || tr("Claim submitted for {0}.", { "0": claim.item }),
      color: "#f59e0b",
    });

    if (claim.status === "Approved" || claim.status === "Verified" || claim.status === "Approved for Pickup") {
      events.push({
        type: "VERIFIED",
        label: getEventLabel("VERIFIED"),
        date: formatDateTime(claim.submittedAt || claim.submitted),
        actor: tr("Admin reviewer"),
        desc: tr("Ownership verified for {0}.", { "0": claim.claimant }),
        color: "#10b981",
      });
    }
  }

  if (item.status === "Released" || item.status === "Claimed" || claim?.status === "Collected") {
    events.push({
      type: "RELEASED",
      label: getEventLabel("RELEASED"),
      date: formatDateTime(item.createdAt || item.dateFound),
      actor: tr("Admin release"),
      desc: tr("Item released to the rightful owner and custody record closed."),
      color: "#6366f1",
    });
  }

  return { id: item.id, events };
}

export default function ChainOfCustody() {
  const [items, setItems] = useState<FoundItemLike[]>([]);
  const [claims, setClaims] = useState<AdminClaimRow[]>([]);
  const [query, setQuery] = useState("");
  const [tracked, setTracked] = useState<CustodyRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const filteredItems = query.trim()
    ? items.filter((item) => {
        const term = query.trim().toLowerCase();
        return (
          item.item.toLowerCase().includes(term) ||
          item.id.toLowerCase().includes(term) ||
          item.locationFound.toLowerCase().includes(term)
        );
      })
    : items;

  useEffect(() => {
    let active = true;

    Promise.all([fetchAdminFoundItems(), fetchAdminClaims()])
      .then(([foundItems, claimRows]) => {
        if (!active) return;
        const mappedItems: FoundItemLike[] = foundItems.map((item: AdminFoundItemRow) => ({
          id: item.id,
          item: item.item,
          description: item.description,
          category: item.category,
          locationFound: item.locationFound,
          dateFound: item.dateFound,
          guardName: item.guardName,
          createdAt: item.createdAt,
          storage: item.storage,
          aiStatus: item.aiStatus,
          aiPercent: item.aiPercent,
          matchedItem: item.matchedItem,
          status: item.status,
          photo: item.photo,
        }));
        setItems(mappedItems);
        setClaims(claimRows);
        if (mappedItems.length > 0) {
          const initialItem = mappedItems[0];
          setQuery(initialItem.item);
          const matchingClaim = claimRows.find((claim) => claim.itemId === initialItem.id || claim.id === initialItem.id);
          setTracked(buildCustodyTimeline(initialItem, matchingClaim));
        }
      })
      .catch(() => {
        setItems([]);
        setClaims([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  const trackItem = () => {
    const term = query.trim();
    if (!term) {
      setTracked(null);
      reportAdminProcess({ success: false, title: "Track custody", message: "Enter an item name or item ID to search the custody database." });
      return;
    }

    const normalizedTerm = term.toLowerCase();
    const item = items.find((foundItem) => {
      const matchesId = foundItem.id.toLowerCase().includes(normalizedTerm);
      const matchesName = foundItem.item.toLowerCase().includes(normalizedTerm);
      return matchesId || matchesName;
    });

    if (!item) {
      setTracked(null);
      reportAdminProcess({ success: false, title: "Track custody", message: "No custody record found. Try the item name or its registered Found Item ID." });
      return;
    }

    const matchingClaim = claims.find((claim) => claim.itemId.toLowerCase() === item.id.toLowerCase() || claim.id.toLowerCase() === item.id.toLowerCase());
    setTracked(buildCustodyTimeline(item, matchingClaim));
    reportAdminProcess({ success: true, title: "Custody record found", message: tr("{0} ({1}) is ready to review.", { "0": item.item, "1": item.id }) });
  };

  const trackedItem = tracked ? items.find((item) => item.id === tracked.id) ?? null : null;
  const exportReport = () => window.print();

  return (
    <div className="print-report p-6 space-y-5">
      <div>
        <h1 className="font-[family-name:var(--font-heading)] text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]"><T k="page.custody" /></h1>
        <p className="mt-1 max-w-[68ch] text-[14px] leading-6 text-ink-muted">{tr("Track the complete handling history of any item in the system.")}</p>
      </div>

      {/* Search */}
      <div className="print-hide bg-white rounded-2xl border border-line shadow-card p-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-2.5 text-slate-400" width="16" height="16" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="m21 21-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && trackItem()}
              placeholder={tr("Search item name or ID")}
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-600/20"
            />
          </div>
          <button onClick={trackItem} className="px-6 py-2.5 text-sm font-semibold text-white rounded-lg hover:opacity-90 transition-opacity" style={{ background: "#1f3160" }}>
            {tr("Track Item")}
          </button>
        </div>

        {query.trim() && filteredItems.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {filteredItems.slice(0, 6).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setQuery(item.item);
                  const matchingClaim = claims.find((claim) => claim.itemId.toLowerCase() === item.id.toLowerCase() || claim.id.toLowerCase() === item.id.toLowerCase());
                  setTracked(buildCustodyTimeline(item, matchingClaim));
                  reportAdminProcess({ success: true, title: "Custody record found", message: tr("{0} ({1}) is ready to review.", { "0": item.item, "1": item.id }) });
                }}
                className="rounded-full border border-line bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-tide-200 hover:bg-tide-50 hover:text-tide-700"
              >
                {item.item}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-5" aria-busy="true"><SkeletonBlock className="h-11 w-full rounded-lg" /><AdminCardGridSkeleton count={3} /></div>
      ) : tracked && trackedItem && (
        <>
          <div className="bg-white rounded-2xl border border-line shadow-card p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                {trackedItem.photo ? (
                  <img src={trackedItem.photo} alt={tr("{0} photo", { "0": trackedItem.item })} className="h-14 w-14 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100">
                    <svg width="28" height="28" fill="none" viewBox="0 0 24 24" className="text-slate-400"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="m21 15-5-5L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  </div>
                )}
                <div>
                  <div className="text-xs font-mono text-slate-400">{trackedItem.id}</div>
                  <div className="text-xl font-bold text-slate-900">{trackedItem.item}</div>
                  <div className="text-sm text-slate-500">{trackedItem.description} · {trackedItem.locationFound}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border" style={{ background: "#ecfdf5", color: "#059669", borderColor: "#a7f3d0" }}>
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  {trackedItem.status}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 mt-5 pt-5 border-t border-line">
              {[
                { icon: <Sparkles size={20} aria-hidden="true" />, label: tr("AI Confidence"), value: trackedItem.aiPercent !== null && trackedItem.aiPercent !== undefined ? (trackedItem.matchedItem ? `${trackedItem.aiPercent}% · ${trackedItem.matchedItem}` : `${trackedItem.aiPercent}%`) : "N/A" },
                { icon: <Archive size={20} aria-hidden="true" />, label: "Storage", value: trackedItem.storage || "Unassigned" },
                { icon: <MapPin size={20} aria-hidden="true" />, label: "Location", value: trackedItem.locationFound || "Unknown" },
                { icon: <ClipboardList size={20} aria-hidden="true" />, label: tr("Handling Events"), value: String(tracked.events.length) },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <div className="mb-1 flex justify-center text-gold-600">{s.icon}</div>
                  <div className="text-xl font-bold text-slate-900">{s.value}</div>
                  <div className="text-xs text-slate-500">{tr(s.label)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="print-hide flex justify-center">
            <button onClick={exportReport} className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 sm:w-auto" style={{ background: "#1f3160" }}>
              <svg width="17" height="17" fill="none" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {tr("Export Chain-of-Custody Report (PDF)")}
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-line shadow-card p-5">
            <h3 className="font-bold text-slate-900 mb-5">{tr("Custody Timeline")}</h3>
            <div className="space-y-0">
              {tracked.events.map((ev, i) => (
                <div key={`${ev.type}-${i}`} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: ev.color }}>
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" className="text-white">
                        {i === 0 && <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor"/>}
                        {i === 1 && <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>}
                        {i === 2 && <rect x="2" y="6" width="8" height="12" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>}
                        {i === 3 && <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" fill="none"/>}
                        {i === 4 && <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}
                        {i === 5 && <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}
                      </svg>
                    </div>
                    {i < tracked.events.length - 1 && <div className="w-0.5 flex-1 my-1" style={{ background: "#e5e7eb", minHeight: "32px" }}></div>}
                  </div>

                  <div className="flex-1 pb-5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: `${ev.color}20`, color: ev.color }}>{ev.label}</span>
                      <span className="text-xs text-slate-400">{ev.date}</span>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-xs font-semibold text-slate-500 mb-0.5">{ev.actor}</div>
                      <div className="text-sm text-slate-700">{ev.desc}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!loading && !tracked && (
        <div className="bg-white rounded-2xl border border-line shadow-card p-16 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Link2 size={28} aria-hidden="true" /></div>
          <div className="text-slate-400 text-sm">{tr("Enter an Item ID above and click")} <strong>{tr("Track Item")}</strong> {tr("to view its custody history.")}</div>
          <div className="text-slate-400 text-xs mt-1">{tr("Try:")} <code className="bg-slate-100 px-1.5 py-0.5 rounded">{tr("EB-F-2026-0042")}</code></div>
        </div>
      )}
    </div>
  );
}
