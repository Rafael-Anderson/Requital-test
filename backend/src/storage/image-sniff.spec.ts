import { sniffImageType } from './image-sniff';

describe('sniffImageType', () => {
  it('recognizes a real JPEG by its magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffImageType(buf)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
  });

  it('recognizes a real PNG by its magic bytes', () => {
    const buf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    expect(sniffImageType(buf)).toEqual({ mime: 'image/png', ext: 'png' });
  });

  it('recognizes a real GIF (87a and 89a) by its magic bytes', () => {
    expect(sniffImageType(Buffer.from('GIF87a...', 'ascii'))).toEqual({
      mime: 'image/gif',
      ext: 'gif',
    });
    expect(sniffImageType(Buffer.from('GIF89a...', 'ascii'))).toEqual({
      mime: 'image/gif',
      ext: 'gif',
    });
  });

  it('recognizes a real WebP by its RIFF/WEBP magic bytes', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'ascii'),
    ]);
    expect(sniffImageType(buf)).toEqual({ mime: 'image/webp', ext: 'webp' });
  });

  it('rejects a PDF disguised with an image-sounding name (checked at the call site, not here) — its real magic bytes never match', () => {
    const pdfBytes = Buffer.from('%PDF-1.4\n...', 'ascii');
    expect(sniffImageType(pdfBytes)).toBeNull();
  });

  it('rejects SVG — XML text never matches a binary image signature, no special case needed', () => {
    const svgBytes = Buffer.from(
      '<?xml version="1.0"?><svg onload="alert(1)"></svg>',
      'ascii',
    );
    expect(sniffImageType(svgBytes)).toBeNull();
  });

  it('rejects an empty or truncated buffer', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});
