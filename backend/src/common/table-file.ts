import { BadRequestException } from '@nestjs/common';
import { parseCsv } from './csv.util';
import { readXlsxRows, XlsxError } from './xlsx-reader';

// One reader for every import: a merchant's export arrives as .csv (comma,
// semicolon or tab separated, UTF-8 with or without a BOM) or, for the
// platform importers, .xlsx. The result is always the same shape the CSV
// importers already consume: one record per data row, keyed by the TRIMMED
// header text, every cell trimmed.

export interface Table {
  headers: string[];
  rows: Record<string, string>[];
  format: 'csv' | 'xlsx';
}

export const MAX_TABLE_BYTES = 5 * 1024 * 1024;

function detectDelimiter(text: string): string {
  // The header line decides. Quoted separators are rare in a header row.
  const firstLine = text.replace(/^\ufeff/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map(
    (d) => [d, firstLine.split(d).length - 1] as const,
  );
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function readTable(
  file: { buffer: Buffer; originalname: string },
  options: { allowXlsx: boolean },
): Table {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.xlsx')) {
    if (!options.allowXlsx) {
      throw new BadRequestException(
        'Only .csv files are accepted for this import',
      );
    }
    let grid: string[][];
    try {
      grid = readXlsxRows(file.buffer);
    } catch (error) {
      if (error instanceof XlsxError)
        throw new BadRequestException(error.message);
      throw error;
    }
    const headerRow = (grid[0] ?? []).map((h) => (h ?? '').trim());
    const headers = headerRow.filter((h) => h !== '');
    const rows: Record<string, string>[] = [];
    for (const raw of grid.slice(1)) {
      if (!raw.some((c) => (c ?? '').trim() !== '')) continue;
      const record: Record<string, string> = {};
      headerRow.forEach((key, i) => {
        if (key !== '') record[key] = (raw[i] ?? '').trim();
      });
      rows.push(record);
    }
    return { headers, rows, format: 'xlsx' };
  }
  if (!name.endsWith('.csv')) {
    throw new BadRequestException(
      options.allowXlsx
        ? 'Only .csv and .xlsx files are accepted'
        : 'Only .csv files are accepted',
    );
  }
  const text = file.buffer.toString('utf-8');
  // A legacy Arabic Excel "CSV" is windows-1256, not UTF-8: decoding it as
  // UTF-8 puts replacement characters in the header. Refuse instead of
  // importing mojibake.
  if (text.slice(0, 4096).includes('�')) {
    throw new BadRequestException(
      'The file is not UTF-8 text. In Excel use Save As, "CSV UTF-8 (Comma delimited)", then upload it again.',
    );
  }
  const rows = parseCsv(text, detectDelimiter(text));
  return {
    headers: rows.length > 0 ? Object.keys(rows[0]) : [],
    rows,
    format: 'csv',
  };
}
