import type { SectionSettings } from "./theme-config-types";

// One tab of the `product_tabs` section — a pill toggle bound to a
// collection (decision TBE2: collections only in v1).
export interface ProductTab {
  id: string;
  label: string;
  collectionId: number;
}

// Filters section.settings.tabs down to structurally-valid entries. A
// malformed tab (missing id/label, non-numeric or non-positive collectionId,
// wrong type, duplicate id) is silently dropped rather than throwing —
// matches the theme-config validator's "shallow beyond structure" stance
// (see backend theme-config.validation.ts) and Phase 2's adversarial test.
// Returns [] when the whole thing is absent or garbage, so the section
// renders nothing at all rather than 400ing the save or crashing the page.
// Pure, no DOM — same convention as theme-element-style.ts / product-badge.ts.
export function resolveProductTabs(settings: SectionSettings | undefined): ProductTab[] {
  const raw = settings?.tabs;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ProductTab[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const { id, label, collectionId } = t as Record<string, unknown>;
    if (typeof id !== "string" || !id) continue;
    if (typeof label !== "string" || !label.trim()) continue;
    if (typeof collectionId !== "number" || !Number.isFinite(collectionId) || collectionId <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: label.trim(), collectionId });
  }
  return out;
}
