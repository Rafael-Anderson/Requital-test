// Every Phase 6+ upload key has the fixed shape `<subdir>/<shopId>/<rest>`
// — shopId is the second path segment, always server-derived from the
// authenticated TenantContext at upload time, never accepted from the
// client. This is what makes per-shop scoping enforceable on delete: given
// any key, the owning shopId can be read back out of the key itself with
// no DB lookup.
export function buildImageKey(
  subdir: string,
  shopId: number,
  id: string,
  variant: '' | 'thumb' | 'medium',
  ext: string,
): string {
  const suffix = variant ? `_${variant}` : '';
  return `${subdir}/${shopId}/${id}${suffix}.${ext}`;
}

// Returns null for anything that doesn't match the `<subdir>/<shopId>/...`
// shape — including every pre-Phase-6 key (no shopId segment at all,
// e.g. "products/<uuid>.jpg") and any malformed input. A null here means
// "ownership can't be verified", which callers must treat as "reject",
// never as "allow" — see StorageService.deleteImage.
export function extractShopIdFromKey(key: string): number | null {
  const parts = key.split('/');
  if (parts.length < 3) return null;
  const shopId = Number(parts[1]);
  return Number.isInteger(shopId) && shopId > 0 ? shopId : null;
}

// The three variant keys sharing one base (original) key — used by delete
// to clean up _thumb/_medium alongside the original in one call, since all
// three were always written together at upload time (see
// StorageService.uploadImage).
export function deriveVariantKeys(originalKey: string): string[] {
  const match = /^(.*)(\.[a-zA-Z0-9]+)$/.exec(originalKey);
  if (!match) return [originalKey];
  const [, base, ext] = match;
  return [originalKey, `${base}_thumb${ext}`, `${base}_medium${ext}`];
}
