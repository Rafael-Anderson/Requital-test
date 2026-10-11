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
// Excel's own per-cell ceiling, and a total of what the reader EMITS. Shared
// strings are returned by reference, so without these a ~25KB file whose rows
// all point at one 25MB string would hand 10k rows of 25MB cells to the callers.
const MAX_CELL_CHARS = 32_767;
const MAX_TOTAL_CHARS = 5_000_000;

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

// ---- linear XML scanning ------------------------------------------------
// The worksheet is attacker-controlled, so NO regex here can backtrack: a lazy
// `[\s\S]*?` repeated for every start tag is quadratic when the end tag is
// missing (`<row>` x 1e6 with no `</row>` blocked the event loop for every
// tenant). Instead every element is found with indexOf, its close tag is
// searched ONCE from the element's own start, and the scan resumes after it.
// A missing close tag is a clear error, never a rescan. Elements scanned are
// counted and capped before anything is allocated for them.

const MAX_CELLS_TOTAL = 2_000_000;
const MAX_CELLS_PER_ROW = 5_000;
const MAX_SHARED_STRINGS = 500_000;
const MAX_TEXT_RUNS = 5_000;

interface Element {
  attrs: string;
  // null for a self-closing element
  body: string | null;
  // index just after the element
  end: number;
}

function malformed(): never {
  throw new XlsxError('This .xlsx file is damaged (unclosed element)');
}

// Index of the '>' that ends the open tag starting at `from` (quote-aware, so
// a '>' inside an attribute value does not end it). -1 when there is none.
function openTagEnd(xml: string, from: number): number {
  let quote = '';
  for (let i = from; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

// The next <tag ...>...</tag> (or <tag .../>) at or after `from`, or null.
function nextElement(xml: string, tag: string, from: number): Element | null {
  const open = `<${tag}`;
  let start = xml.indexOf(open, from);
  while (start !== -1) {
    const after = xml.charCodeAt(start + open.length);
    // The name must end here: `<c` is not `<cols`, `<t` is not `<tableParts`.
    if (
      after === 62 || // >
      after === 47 || // /
      after === 32 ||
      after === 9 ||
      after === 10 ||
      after === 13
    ) {
      break;
    }
    start = xml.indexOf(open, start + open.length);
  }
  if (start === -1) return null;
  const tagEnd = openTagEnd(xml, start + open.length);
  if (tagEnd === -1) malformed();
  const attrs = xml.slice(start + open.length, tagEnd);
  if (xml[tagEnd - 1] === '/') {
    return { attrs: attrs.slice(0, -1), body: null, end: tagEnd + 1 };
  }
  const close = xml.indexOf(`</${tag}>`, tagEnd + 1);
  if (close === -1) malformed();
  return {
    attrs,
    body: xml.slice(tagEnd + 1, close),
    end: close + tag.length + 3,
  };
}

function textOf(fragment: string): string {
  let out = '';
  let pos = 0;
  let runs = 0;
  for (let el = nextElement(fragment, 't', pos); el;) {
    runs += 1;
    if (runs > MAX_TEXT_RUNS) {
      throw new XlsxError('This .xlsx file has too many text runs in a cell');
    }
    if (el.body !== null) out += decodeXml(el.body);
    pos = el.end;
    el = nextElement(fragment, 't', pos);
  }
  return out;
}

// Drops every <rPh>...</rPh> (phonetic runs: furigana, not cell text).
function withoutPhonetic(body: string): string {
  if (!body.includes('<rPh')) return body;
  let out = '';
  let pos = 0;
  for (;;) {
    const el = nextElement(body, 'rPh', pos);
    if (!el) break;
    out += body.slice(pos, body.indexOf('<rPh', pos));
    pos = el.end;
  }
  return out + body.slice(pos);
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  let pos = 0;
  for (let el = nextElement(xml, 'si', pos); el;) {
    if (out.length >= MAX_SHARED_STRINGS) {
      throw new XlsxError('This .xlsx file has too many shared strings');
    }
    out.push(el.body === null ? '' : textOf(withoutPhonetic(el.body)));
    pos = el.end;
    el = nextElement(xml, 'si', pos);
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
  let scannedRows = 0;
  let scannedCells = 0;
  let emittedChars = 0;
  let rowPos = 0;
  for (let rm = nextElement(sheet, 'row', rowPos); rm;) {
    scannedRows += 1;
    if (scannedRows > MAX_ROWS) {
      throw new XlsxError('This .xlsx file has too many rows');
    }
    const rowRef = /\br="(\d+)"/.exec(rm.attrs);
    const rowIndex = rowRef ? Number(rowRef[1]) - 1 : rows.length;
    if (rowIndex >= MAX_ROWS) {
      throw new XlsxError('This .xlsx file has too many rows');
    }
    while (rows.length < rowIndex) rows.push([]);
    const cells: string[] = [];
    const body = rm.body ?? '';
    let rowCells = 0;
    let next = 0;
    let cellPos = 0;
    for (let cm = nextElement(body, 'c', cellPos); cm;) {
      rowCells += 1;
      scannedCells += 1;
      if (rowCells > MAX_CELLS_PER_ROW || scannedCells > MAX_CELLS_TOTAL) {
        throw new XlsxError('This .xlsx file has too many cells');
      }
      cellPos = cm.end;
      const ref = /\br="([A-Z]+)\d+"/.exec(cm.attrs);
      const col = ref ? columnIndex(ref[1]) : next;
      if (col < MAX_COLUMNS) {
        next = col + 1;
        const type = /\bt="([^"]*)"/.exec(cm.attrs)?.[1] ?? 'n';
        const inner = cm.body ?? '';
        let value = '';
        if (type === 'inlineStr') {
          value = textOf(inner);
        } else {
          const v = nextElement(inner, 'v', 0)?.body ?? undefined;
          if (v !== undefined) {
            if (type === 's') value = strings[Number(v)] ?? '';
            else if (type === 'b') value = v.trim() === '1' ? 'TRUE' : 'FALSE';
            else if (type === 'e') value = '';
            else value = decodeXml(v);
          }
        }
        if (value.length > MAX_CELL_CHARS) {
          throw new XlsxError('This .xlsx file has a cell with too much text');
        }
        emittedChars += value.length;
        if (emittedChars > MAX_TOTAL_CHARS) {
          throw new XlsxError('This .xlsx file has too much text');
        }
        while (cells.length < col) cells.push('');
        cells[col] = value;
      }
      cm = nextElement(body, 'c', cellPos);
    }
    rows[rowIndex] = cells;
    rowPos = rm.end;
    rm = nextElement(sheet, 'row', rowPos);
  }
  return rows;
}
