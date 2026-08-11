// Pure validators for shop.customDomain — kept framework-free (no
// class-validator dependency) so domain-validation.spec.ts can exercise them
// directly, same reasoning as admin/lib/validators.ts on the frontend side.
// Mirrored by hand in admin/lib/validators.ts's validateCustomDomain.

// A conservative real-hostname check: labels of letters/digits/hyphens (no
// leading/trailing hyphen per-label), at least one dot, a letters-only TLD.
// Deliberately doesn't allow a protocol, path, port, or trailing slash —
// normalizeCustomDomain() strips those before this ever runs, so rejecting
// them here is defense-in-depth against a caller that skipped that step.
const HOSTNAME_REGEX =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/;

export function isValidCustomDomain(value: string): boolean {
  return value.length > 0 && value.length <= 253 && HOSTNAME_REGEX.test(value);
}
