import { tr } from "../utils/preferences";
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />;
}

export function AdminTableSkeleton({ columns = 6, rows = 6 }: { columns?: number; rows?: number }) {
  const gridColumns = `repeat(${columns}, minmax(0, 1fr))`;
  return (
    <div aria-label={tr("Loading records")} aria-busy="true" className="rounded-2xl border border-line bg-white p-5">
      <div className="space-y-4">
        <div className="grid gap-4 border-b border-line pb-3" style={{ gridTemplateColumns: gridColumns }}>
          {Array.from({ length: columns }, (_, index) => <SkeletonBlock key={index} className="h-3 w-3/4" />)}
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="grid items-center gap-4 border-b border-line py-3 last:border-0" style={{ gridTemplateColumns: gridColumns }}>
            {Array.from({ length: columns }, (_, column) => <SkeletonBlock key={column} className={`h-3 ${column === 0 ? "w-4/5" : "w-2/3"}`} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminCardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-label={tr("Loading records")} aria-busy="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-2xl border border-line bg-white p-5">
          <SkeletonBlock className="mb-4 h-28 w-full rounded-xl" />
          <SkeletonBlock className="mb-3 h-4 w-2/3" />
          <SkeletonBlock className="mb-2 h-3 w-full" />
          <SkeletonBlock className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function AdminMetricSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-label={tr("Loading metrics")} aria-busy="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-2xl border border-line bg-white p-5">
          <SkeletonBlock className="mb-4 h-3 w-1/2" />
          <SkeletonBlock className="h-7 w-1/3" />
        </div>
      ))}
    </div>
  );
}
