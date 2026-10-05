import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { tr, trText, useT } from "../../utils/preferences";
import type { StringKey } from "../../i18n/strings";
import { BTN, INPUT } from "./primitives";

/**
 * Shared layout for every management page (Lost, Found, Claims, Users):
 * PageHeader → Toolbar → DataTable (pinned actions column) → footer with paging.
 */

export type Tone = "gold" | "mint" | "rose" | "iris" | "slate";

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className="pill" data-tone={tone}>{trText(children)}</span>;
}

/** Status tabs with live counts; the active tab carries the gold accent. */
export function SegmentedFilter<V extends string>({ label, value, onChange, options }: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: string; count?: number }[];
}) {
  return (
    <div role="tablist" aria-label={tr(label)} className="glass-panel flex w-full max-w-full gap-1 overflow-x-auto p-1.5 sm:w-fit">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`flex min-h-[38px] shrink-0 items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-semibold transition-colors ${active ? "bg-navy-800 text-white shadow-sm dark:bg-[linear-gradient(180deg,#ecc787,#d1a153)] dark:text-navy-950 dark:shadow-[0_8px_24px_-10px_rgba(209,161,83,0.7)]" : "text-ink-muted hover:bg-navy-50 hover:text-ink"}`}
          >
            {trText(option.label)}
            {option.count !== undefined && (
              <span className={`min-w-[22px] rounded-full px-1.5 text-center text-[12px] tabular-nums ${active ? "bg-white/20 dark:bg-navy-950/15" : "bg-frost-100 text-ink-soft"}`}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Toolbar({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="glass-panel flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>
      {trailing && <div className="flex shrink-0 flex-wrap items-center gap-2">{trailing}</div>}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const t = useT();
  return (
    <label className="relative min-w-0 flex-[2] sm:min-w-[240px]">
      <span className="sr-only">{t("common.search")}</span>
      <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`${INPUT} pl-10`} />
    </label>
  );
}

export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="min-w-0 sm:w-auto sm:min-w-[170px]">
      <span className="sr-only">{tr(label)}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={INPUT} aria-label={tr(label)}>
        {options.map((option) => <option key={option.value} value={option.value}>{tr(option.label)}</option>)}
      </select>
    </label>
  );
}

export function ExportButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={BTN.ghost}>
      <Download size={16} aria-hidden="true" />{t("common.exportCsv")}
    </button>
  );
}

export interface Column {
  key: string;
  label: string;
  className?: string;
}

/** Table card. The last column is pinned to the right edge so row actions never scroll out of reach. */
export function DataTable({ columns, children, empty, isEmpty, footer, minWidth = 960, caption }: {
  columns: Column[];
  children: ReactNode;
  empty: ReactNode;
  isEmpty: boolean;
  footer?: ReactNode;
  minWidth?: number;
  caption: string;
}) {
  return (
    <section className="glass-panel overflow-hidden">
      <div className="mgmt-scroll">
        <table className="mgmt-table" style={{ minWidth }}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={column.key} scope="col" className={`${index === columns.length - 1 ? "mgmt-actions" : ""} ${column.className ?? ""}`}>{tr(column.label)}</th>
              ))}
            </tr>
          </thead>
          {!isEmpty && <tbody>{children}</tbody>}
        </table>
      </div>
      {/* Outside the scroller so the message stays centred in the card, not in the wide table. */}
      {isEmpty && <p className="px-6 py-14 text-center text-[14px] text-ink-muted">{empty}</p>}
      {footer}
    </section>
  );
}

export function RowActions({ children }: { children: ReactNode }) {
  return <td className="mgmt-actions"><div className="flex items-center justify-end gap-0.5">{children}</div></td>;
}

export function IconAction({ label, onClick, icon, tone, disabled }: { label: string; onClick: () => void; icon: ReactNode; tone?: "danger" | "success" | "gold"; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="icon-action" data-tone={tone} aria-label={tr(label)} title={tr(label)}>
      {icon}
    </button>
  );
}

/** Thumbnail cell for item photos with a neutral placeholder. */
export function Thumb({ src, alt }: { src?: string; alt: string }) {
  return src ? (
    <img src={src} alt={alt} loading="lazy" className="size-11 shrink-0 rounded-xl object-cover ring-1 ring-line" />
  ) : (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-frost-100 text-ink-muted ring-1 ring-line" aria-hidden="true">
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8" /><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" /><path d="m21 15-5-5L5 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
    </span>
  );
}

export function usePagination<T>(items: T[], pageSize = 12, resetKey?: unknown) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => { setPage(1); }, [resetKey]);
  const current = Math.min(page, totalPages);
  const pageItems = useMemo(() => items.slice((current - 1) * pageSize, current * pageSize), [items, current, pageSize]);
  return { page: current, setPage, totalPages, pageItems, from: items.length ? (current - 1) * pageSize + 1 : 0, to: Math.min(current * pageSize, items.length), total: items.length };
}

export function TableFooter({ from, to, total, page, totalPages, onPage }: { from: number; to: number; total: number; page: number; totalPages: number; onPage: (page: number) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-[13px] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <span className="tabular-nums">{t("common.showing", { from, to, total })}</span>
      {totalPages > 1 && (
        <nav className="flex items-center gap-1" aria-label={tr("Pagination")}>
          <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className="icon-action" aria-label={t("common.previous")}><ChevronLeft size={17} aria-hidden="true" /></button>
          <span className="min-w-[64px] text-center font-semibold tabular-nums text-ink-soft">{page} / {totalPages}</span>
          <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages} className="icon-action" aria-label={t("common.next")}><ChevronRight size={17} aria-hidden="true" /></button>
        </nav>
      )}
    </div>
  );
}

/** Label/value grid used inside view dialogs. */
export function DetailGrid({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-2.5 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-line bg-frost-50 px-4 py-3">
          <dt className="text-[12.5px] font-medium text-ink-muted">{tr(label)}</dt>
          <dd className="mt-0.5 break-words text-[14.5px] font-semibold text-ink">{trText(value) || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Inline translated text for headings in pages that otherwise keep their own copy. */
export function T({ k }: { k: StringKey }) {
  const t = useT();
  return <>{t(k)}</>;
}
