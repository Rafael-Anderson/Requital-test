import {
  buildImageKey,
  deriveVariantKeys,
  extractShopIdFromKey,
} from './storage-key';

describe('buildImageKey', () => {
  it('builds the original key with no variant suffix', () => {
    expect(buildImageKey('products', 42, 'abc123', '', 'jpg')).toBe(
      'products/42/abc123.jpg',
    );
  });

  it('builds thumb/medium keys with the expected suffix', () => {
    expect(buildImageKey('products', 42, 'abc123', 'thumb', 'jpg')).toBe(
      'products/42/abc123_thumb.jpg',
    );
    expect(buildImageKey('products', 42, 'abc123', 'medium', 'jpg')).toBe(
      'products/42/abc123_medium.jpg',
    );
  });
});

describe('extractShopIdFromKey', () => {
  it('reads the shopId out of a well-formed key', () => {
    expect(extractShopIdFromKey('products/42/abc123.jpg')).toBe(42);
    expect(extractShopIdFromKey('theme/7/abc123_thumb.png')).toBe(7);
  });

  it('returns null for a pre-Phase-6 key with no shopId segment', () => {
    expect(extractShopIdFromKey('products/abc123.jpg')).toBeNull();
  });

  it('returns null for a malformed or non-numeric segment', () => {
    expect(extractShopIdFromKey('products/not-a-number/abc123.jpg')).toBeNull();
    expect(extractShopIdFromKey('')).toBeNull();
    expect(extractShopIdFromKey('products/0/abc123.jpg')).toBeNull();
    expect(extractShopIdFromKey('products/-1/abc123.jpg')).toBeNull();
  });
});

describe('deriveVariantKeys', () => {
  it('returns the original plus _thumb/_medium siblings', () => {
    expect(deriveVariantKeys('products/42/abc123.jpg')).toEqual([
      'products/42/abc123.jpg',
      'products/42/abc123_thumb.jpg',
      'products/42/abc123_medium.jpg',
    ]);
  });

  it('falls back to just the original key when it has no extension', () => {
    expect(deriveVariantKeys('products/42/abc123')).toEqual([
      'products/42/abc123',
    ]);
  });
});
