// Real magic-byte content sniffing — never trust the client's Content-Type
// header (see docs/audit-2026-08.md §1.3: multer's fileFilter previously
// checked file.mimetype, which is populated straight from the request's
// declared Content-Type, not the actual bytes). A hand-rolled lookup table
// rather than a library (e.g. `file-type`): the whitelist is a fixed set of
// exactly four well-known, trivially-identified binary formats, so a
// dependency buys nothing here except supply-chain surface and — for
// `file-type` specifically — ESM-only friction against this project's
// nodenext/ts-jest setup. Each signature below is the format's own
// published magic-byte spec, not a guess.
export interface SniffedImage {
  mime: string;
  // Always the canonical extension for the sniffed type — the stored
  // filename's extension is derived from THIS, never from the client's
  // originalname, so a mislabeled file (".jpg" that's actually a PDF, or
  // vice versa) can never result in a mismatched stored extension.
  ext: string;
}

interface Signature extends SniffedImage {
  test: (buf: Buffer) => boolean;
}

const SIGNATURES: Signature[] = [
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) =>
      b.length >= 8 &&
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    test: (b) => {
      if (b.length < 6) return false;
      const header = b.subarray(0, 6).toString('ascii');
      return header === 'GIF87a' || header === 'GIF89a';
    },
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

// Returns null for anything unrecognized — including SVG (XML text never
// matches a binary signature above, so SVG rejection falls out of this
// whitelist automatically, with no SVG-specific special case needed) and
// polyglot files carrying a real image's extension but different bytes.
export function sniffImageType(buffer: Buffer): SniffedImage | null {
  for (const sig of SIGNATURES) {
    if (sig.test(buffer)) {
      return { mime: sig.mime, ext: sig.ext };
    }
  }
  return null;
}
