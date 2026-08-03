// Pure, DB-free — extracted so the actual combinatorial logic is
// unit-testable without spinning up Prisma (same rationale as
// lib/color-contrast.ts / affiliate commission calc elsewhere in this repo).

export const MAX_PRODUCT_OPTIONS = 3;
export const MAX_VARIANTS_PER_PRODUCT = 100;

export type OptionValueCombo = [number | null, number | null, number | null];

// Cartesian product of option value id lists, e.g. [[1,2],[10,11]] (2 sizes
// x 2 colors) -> [[1,10],[1,11],[2,10],[2,11]]. Padded to exactly 3 slots
// with null for unused option positions, matching productvariant's
// optionValue1Id/2Id/3Id columns directly (1-2 options still produce
// 3-element tuples with trailing nulls).
export function generateVariantCombinations(
  valueIdsByOption: number[][],
): OptionValueCombo[] {
  if (valueIdsByOption.length === 0) return [];
  let combos: number[][] = [[]];
  for (const values of valueIdsByOption) {
    const next: number[][] = [];
    for (const combo of combos) {
      for (const v of values) {
        next.push([...combo, v]);
      }
    }
    combos = next;
  }
  return combos.map((combo) => [
    combo[0] ?? null,
    combo[1] ?? null,
    combo[2] ?? null,
  ]);
}

export function comboKey(combo: OptionValueCombo): string {
  return combo.join(':');
}

// Human-readable variant name built from its option values, e.g.
// ["Small", "Red", undefined] -> "Small / Red". Shared by ProductsService's
// admin-facing variant response and order creation's variantLabel snapshot
// (see resolveOrderItems) so both render the exact same string.
export function buildVariantLabel(
  values: (string | null | undefined)[],
): string | null {
  const label = values.filter((v): v is string => Boolean(v)).join(' / ');
  return label || null;
}
