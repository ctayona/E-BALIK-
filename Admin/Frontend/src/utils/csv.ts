/** Client-side CSV export for the records an admin currently has filtered on screen. */

type Cell = string | number | boolean | null | undefined;

function escapeCell(value: Cell): string {
  let text = value == null ? "" : String(value);
  // Neutralise spreadsheet formula injection (cells starting with = + - @ or control characters).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(baseName: string, headers: string[], rows: Cell[][]) {
  const body = [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
  // BOM so Excel opens UTF-8 names (ñ, accents) correctly.
  const blob = new Blob(["﻿", body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
