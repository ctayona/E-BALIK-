import type { ReactNode } from "react";

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-slate-200 ${className}`} />;
}

export function ReportGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-label="Loading reports" aria-busy="true" className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-line bg-white/95 p-4">
          <div className="flex gap-3">
            <SkeletonBlock className="size-[72px] shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-3 py-1">
              <SkeletonBlock className="h-3 w-20" />
              <SkeletonBlock className="h-4 w-3/4" />
              <SkeletonBlock className="h-3 w-1/2" />
            </div>
          </div>
          <SkeletonBlock className="mt-4 h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

export function ReportListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div aria-label="Loading reports" aria-busy="true" className="space-y-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl border border-line bg-white/95 p-3">
          <SkeletonBlock className="size-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock className="h-3 w-1/3" />
            <SkeletonBlock className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ columns = 6, rows = 6 }: { columns?: number; rows?: number }) {
  const gridColumns = `repeat(${columns}, minmax(0, 1fr))`;
  return (
    <div aria-label="Loading records" aria-busy="true" className="space-y-3">
      <div className="grid gap-4 border-b border-line px-4 pb-3" style={{ gridTemplateColumns: gridColumns }}>
        {Array.from({ length: columns }, (_, index) => <SkeletonBlock key={index} className="h-3 w-3/4" />)}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="grid items-center gap-4 border-b border-[#eef2f7] px-4 py-3" style={{ gridTemplateColumns: gridColumns }}>
          {Array.from({ length: columns }, (_, column) => (
            <SkeletonBlock key={column} className={`h-3 ${column === 0 ? "w-4/5" : "w-2/3"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <div aria-label="Loading content" aria-busy="true" className={`rounded-2xl border border-line bg-white/95 p-5 ${className}`}>
      {children || <div className="space-y-4"><SkeletonBlock className="h-4 w-1/3" /><SkeletonBlock className="h-32 w-full rounded-xl" /><SkeletonBlock className="h-3 w-2/3" /></div>}
    </div>
  );
}
