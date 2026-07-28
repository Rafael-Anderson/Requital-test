// No CSV/export precedent existed anywhere in this codebase — built from
// scratch. Client-side blob generation rather than a backend endpoint: the
// admin already has the rows in memory (they're what's rendered in the
// table), so there's nothing a server round-trip would add except latency.
function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  // ﻿ BOM so Excel (still the most common opener) detects UTF-8
  // instead of guessing the system codepage and mangling non-ASCII text.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
