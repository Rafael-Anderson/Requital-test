import { normalizeTrn, normalizeWebsiteUrl } from './normalize';

describe('normalizeWebsiteUrl', () => {
  it('leaves an already-protocol-prefixed URL unchanged', () => {
    expect(normalizeWebsiteUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('http://example.com')).toBe('http://example.com');
  });

  it('prefixes a bare domain with https://', () => {
    expect(normalizeWebsiteUrl('example.com')).toBe('https://example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeWebsiteUrl('  example.com  ')).toBe('https://example.com');
  });

  it('returns an empty string unchanged', () => {
    expect(normalizeWebsiteUrl('')).toBe('');
  });
});

describe('normalizeTrn', () => {
  it('strips dashes and spaces to digits-only', () => {
    expect(normalizeTrn('100-1234-567-890')).toBe('1001234567890');
    expect(normalizeTrn('100 1234 567 890')).toBe('1001234567890');
  });

  it('leaves an already digits-only TRN unchanged', () => {
    expect(normalizeTrn('123456789012345')).toBe('123456789012345');
  });

  it('returns an empty string unchanged', () => {
    expect(normalizeTrn('')).toBe('');
  });
});
