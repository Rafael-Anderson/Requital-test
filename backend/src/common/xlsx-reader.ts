import { inflateRawSync } from 'zlib';

// Minimal .xlsx reader (no dependency): the first worksheet as rows of text.
// An .xlsx is a ZIP of XML parts; we read the central directory, inflate only
// the three parts we need (workbook rels are skipped: sheet1 / the first
// worksheet is used) and scan the XML with linear regexes.
//
// The file is attacker-controlled, so: sizes are capped BEFORE and DURING
// inflation (a zip bomb stops at the cap), encrypted and zip64 archives are
// refused, entry names are only compared, never used as paths, and XML
// entities are decoded from a fixed table (no DTD, no external entity).
// Numbers come back exactly as the file stores them (Excel stores a typed
// price like 10.505 as the text "10.505"); formulas are never evaluated.

export class XlsxError extends Error {}

const MAX_ENTRIES = 2000;
const MAX_SHEET_BYTES = 30 * 1024 * 1024;
const MAX_STRINGS_BYTES = 30 * 1024 * 1024;
const MAX_ROWS = 50_000;
const MAX_COLUMNS = 200;

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function readEntries(buf: Buffer): Map<string, ZipEntry> {
  // End of central directory: signature 0x06054b50, within the last 64KB+22.
  const minPos = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('This is not a valid .xlsx file');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new XlsxError('This .xlsx file uses an unsupported ZIP format');
  }
  if (total > MAX_ENTRIES || cdOffset + cdSize > buf.length) {
    throw new XlsxError('This is not a valid .xlsx file');
  }
  const entries = new Map<string, ZipEntry>();
  let p = cdOffset;
  for (let n = 0; n < total; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new XlsxError('This is not a valid .xlsx file');
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, {
      name,
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf: Buffer, entry: ZipEntry, maxBytes: number): string {
  if (entry.flags & 1)
    throw new XlsxError('Encrypted .xlsx files are not supported');
  if (
    entry.compressedSize === 0xffffffff ||
    entry.uncompressedSize === 0xffffffff
  ) {
    throw new XlsxError('This .xlsx file uses an unsupported ZIP format');
  }
  if (entry.uncompressedSize > maxBytes) {
    throw new XlsxError('This .xlsx file is too large to import');
  }
  const o = entry.localOffset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) {
    throw new XlsxError('This is not a valid .xlsx file');
  }
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new XlsxError('This is not a valid .xlsx file');
  const data = buf.subarray(start, end);
  try {
    if (entry.method === 0) {
      if (data.length > maxBytes)
        throw new XlsxError('This .xlsx file is too large to import');
      return data.toString('utf8');
    }
    if (entry.method === 8) {
      // maxOutputLength stops a bomb whose header lies about its size.
      return inflateRawSync(data, { maxOutputLength: maxBytes }).toString(
        'utf8',
      );
    }
  } catch (error) {
    if (error instanceof XlsxError) throw error;
    throw new XlsxError(
      'This .xlsx file could not be read (too large or damaged)',
    );
  }
  throw new XlsxError('This .xlsx file uses an unsupported compression method');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g,
    (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
        return String.fromCodePoint(code);
      }
      return ENTITIES[body] ?? whole;
    },
  );
}

function textOf(fragment: string): string {
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) out += decodeXml(m[1]);
  return out;
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    // Phonetic runs (<rPh>) are furigana, not part of the cell text.
    out.push(textOf(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));
  }
  return out;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

export function readXlsxRows(buffer: Buffer): string[][] {
  const entries = readEntries(buffer);
  const sheetName = entries.has('xl/worksheets/sheet1.xml')
    ? 'xl/worksheets/sheet1.xml'
    : [...entries.keys()]
        .filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k))
        .sort()[0];
  if (!sheetName) throw new XlsxError('This .xlsx file has no worksheet');
  const stringsEntry = entries.get('xl/sharedStrings.xml');
  const strings = stringsEntry
    ? sharedStrings(readEntry(buffer, stringsEntry, MAX_STRINGS_BYTES))
    : [];
  const sheet = readEntry(buffer, entries.get(sheetName)!, MAX_SHEET_BYTES);

  const rows: string[][] = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(sheet)) !== null) {
    const rowRef = /\br="(\d+)"/.exec(rm[1]);
    const rowIndex = rowRef ? Number(rowRef[1]) - 1 : rows.length;
    if (rowIndex >= MAX_ROWS)
      throw new XlsxError('This .xlsx file has too many rows');
    while (rows.length < rowIndex) rows.push([]);
    const cells: string[] = [];
    const body = rm[2] ?? '';
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let next = 0;
    while ((cm = cellRe.exec(body)) !== null) {
      const ref = /\br="([A-Z]+)\d+"/.exec(cm[1]);
      const col = ref ? columnIndex(ref[1]) : next;
      if (col >= MAX_COLUMNS) continue;
      next = col + 1;
      const type = /\bt="([^"]*)"/.exec(cm[1])?.[1] ?? 'n';
      const inner = cm[2] ?? '';
      let value = '';
      if (type === 'inlineStr') {
        value = textOf(inner);
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) {
          if (type === 's') value = strings[Number(v)] ?? '';
          else if (type === 'b') value = v.trim() === '1' ? 'TRUE' : 'FALSE';
          else if (type === 'e') value = '';
          else value = decodeXml(v);
        }
      }
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    rows[rowIndex] = cells;
  }
  return rows;
}
