// The merchant-facing half of moving delivery zones from free-text names to
// region sets: what a zone does TODAY, in words, and what region set it most
// plausibly means. Pure, so the screen's proposals are unit-testable.
//
// A proposal is only ever a SUGGESTION the merchant reviews. `confident` is true
// only when the zone's name IS a region name (or a list of them), and even then
// the merchant confirms: the whole point of the screen is that a silent backfill
// would change live delivery fees.

export interface RegionLite {
  id: number;
  nameEn: string;
  nameAr: string;
}

export type ProposalReason =
  'exact-name' | 'token-split' | 'contains-name' | 'none';

export interface RegionProposal {
  regionIds: number[];
  reason: ProposalReason;
  confident: boolean;
  explanation: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function proposeRegions(
  zoneName: string,
  regions: RegionLite[],
): RegionProposal {
  const n = norm(zoneName);
  const byName = (name: string) =>
    regions.find((r) => norm(r.nameEn) === name || r.nameAr.trim() === name);

  const exact = byName(n);
  if (exact) {
    return {
      regionIds: [exact.id],
      reason: 'exact-name',
      confident: true,
      explanation: `The zone name is exactly "${exact.nameEn}".`,
    };
  }

  // "Dubai, Sharjah" / "Dubai/Sharjah/Ajman" / "Dubai and Sharjah": a list of
  // region names. Only when EVERY token is a region: a partial match would quietly
  // drop the rest of what the merchant meant.
  const tokens = n
    .split(/[/,&+|]| and /)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length > 1) {
    const found = tokens.map(byName);
    if (found.every(Boolean)) {
      const ids = [...new Set(found.map((r) => (r as RegionLite).id))];
      return {
        regionIds: ids,
        reason: 'token-split',
        confident: true,
        explanation: `The zone name lists ${ids.length} regions: ${found
          .map((r) => `"${(r as RegionLite).nameEn}"`)
          .join(', ')}.`,
      };
    }
  }

  const contained = regions.filter((r) =>
    new RegExp(`(^|[^a-z])${escapeRegExp(norm(r.nameEn))}([^a-z]|$)`).test(n),
  );
  if (contained.length > 0) {
    return {
      regionIds: contained.map((r) => r.id),
      reason: 'contains-name',
      confident: false,
      explanation: `The zone name mentions ${contained
        .map((r) => `"${r.nameEn}"`)
        .join(
          ', ',
        )}, but is not exactly that. Check that this zone should cover the whole region and not just part of it.`,
    };
  }

  return {
    regionIds: [],
    reason: 'none',
    confident: false,
    explanation:
      'The zone name does not match any region. Choose the regions it covers, or place its map circle.',
  };
}

// What the zone does under the OLD rule (name compared with the customer's area,
// then their emirate), in a sentence a merchant can check against what they meant.
export function describeLegacyMatching(
  zone: { name: string; hasPlacedCircle: boolean },
  regions: RegionLite[],
): string {
  const n = norm(zone.name);
  const region = regions.find((r) => norm(r.nameEn) === n);
  const parts: string[] = [];
  if (region) {
    parts.push(`every customer whose emirate is ${region.nameEn}`);
    parts.push(`anyone who types the area "${zone.name.trim()}"`);
  } else {
    parts.push(
      `only customers who type the area "${zone.name.trim()}" exactly`,
    );
  }
  if (zone.hasPlacedCircle) {
    parts.push('customers whose map pin is inside its circle');
  }
  return `Currently matches ${parts.join(', and ')}.`;
}
