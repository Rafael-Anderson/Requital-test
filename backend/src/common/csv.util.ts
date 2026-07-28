// Hand-rolled RFC4180 parser — no CSV library was already a dependency here
// (admin/lib/csv.ts is export-only and equally hand-rolled), and the shape
// needed — quoted fields, escaped quotes, embedded commas/newlines — is
// small enough that adding papaparse/csv-parse for this alone isn't worth it.
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text.replace(/^﻿/, ''));
  if (rows.length === 0) return [];
  const [header, ...dataRows] = rows;
  return dataRows
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => {
      const record: Record<string, string> = {};
      header.forEach((key, i) => {
        record[key.trim()] = (row[i] ?? '').trim();
      });
      return record;
    });
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
