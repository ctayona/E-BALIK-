import { lazy, Suspense } from "react";
import { SegmentedFilter } from "../../components/ui/management";
import { AdminTableSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import { tr } from "../../utils/preferences";
import CustodyView from "./CustodyView";

const LostItems = lazy(() => import("../lost-items/LostItems"));
const FoundItems = lazy(() => import("../found-items/FoundItems"));

export type ReportsTab = "lost" | "found" | "custody";

/**
 * One page for everything people reported: the lost reports, the found reports, and the items the office is holding.
 * Each tab keeps its own table, filters and actions, so nothing is duplicated.
 */
export default function Reports({ tab, onTabChange, onNavigate }: { tab: ReportsTab; onTabChange: (tab: ReportsTab) => void; onNavigate: (page: "claims" | "auctions") => void }) {
  return (
    <div>
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <p className="mb-3 max-w-[70ch] text-[14px] text-ink-muted">{tr("Lost reports, found reports and the items in custody, in one place. Use the tabs to switch.")}</p>
        <SegmentedFilter
          label="Report type"
          value={tab}
          onChange={onTabChange}
          options={[
            { value: "lost", label: "Lost reports" },
            { value: "found", label: "Found reports" },
            { value: "custody", label: "Items in custody" },
          ]}
        />
      </div>
      <Suspense fallback={<div className="space-y-5 p-4 sm:p-6" aria-busy="true"><SkeletonBlock className="h-8 w-56" /><AdminTableSkeleton columns={7} rows={6} /></div>}>
        {tab === "lost" && <LostItems />}
        {tab === "found" && <FoundItems />}
        {tab === "custody" && <div className="p-4 sm:p-6"><CustodyView onNavigate={onNavigate} /></div>}
      </Suspense>
    </div>
  );
}
