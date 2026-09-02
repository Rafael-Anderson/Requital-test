import type { ThemeBlock } from "./theme-config-types";

export interface ResolvedHeaderRow {
  id: string;
  align: "left" | "center" | "right" | "between";
  background?: string;
  blocks: ThemeBlock[];
}

// Reads header.settings.rows (theme-builder-expansion Phase 3, decision
// TBE1) and resolves each row's blockIds against the flat header blocks[].
//
// Returns null — meaning "render the pre-existing single 3-zone grid,
// unchanged" — whenever rows is absent, empty, not an array, or contains no
// structurally-valid row. This null path is the hard backstop for the
// "rows absent ⇒ header renders pixel-identical to today" regression
// guarantee: ThemeDrivenHeader keeps its exact old code path when this
// returns null.
//
// When rows ARE valid: a visible block not referenced by any row is appended
// to the last row so nothing is silently dropped — EXCEPT nav_menu, which
// only ever renders in a row when explicitly placed there (otherwise it
// stays the separate below-header MenuBar row; see navMenuInHeaderRow).
//
// Pure, no DOM — same convention as product-badge.ts / product-tabs.ts.
export function resolveHeaderRows(
  settings: Record<string, unknown> | undefined,
  blocks: ThemeBlock[],
): ResolvedHeaderRow[] | null {
  const raw = settings?.rows;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const visible = blocks.filter((b) => b.visible);
  const byId = new Map(visible.map((b) => [b.id, b]));
  const used = new Set<string>();

  const rows: ResolvedHeaderRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { id, blockIds, align, background } = r as Record<string, unknown>;
    if (typeof id !== "string" || !id) continue;
    if (!Array.isArray(blockIds)) continue;

    const rowBlocks: ThemeBlock[] = [];
    for (const bid of blockIds) {
      if (typeof bid !== "string") continue;
      const b = byId.get(bid);
      if (b && !used.has(bid)) {
        used.add(bid);
        rowBlocks.push(b);
      }
    }
    rows.push({
      id,
      align: align === "center" || align === "right" || align === "between" ? align : "left",
      background: typeof background === "string" && background ? background : undefined,
      blocks: rowBlocks,
    });
  }

  if (rows.length === 0) return null;

  const leftover = visible.filter((b) => !used.has(b.id) && b.type !== "nav_menu");
  if (leftover.length > 0) rows[rows.length - 1].blocks.push(...leftover);

  return rows;
}

// True only when the nav_menu block is EXPLICITLY listed in a row's
// blockIds. ShopLayoutClient uses this to skip the separate below-header
// MenuBar row (ThemeDrivenHeader renders <MenuBar inline /> in the row
// instead). A nav_menu block that isn't placed in any row keeps the classic
// below-header nav.
export function navMenuInHeaderRow(
  settings: Record<string, unknown> | undefined,
  blocks: ThemeBlock[],
): boolean {
  const raw = settings?.rows;
  if (!Array.isArray(raw)) return false;
  const navBlock = blocks.find((b) => b.type === "nav_menu");
  if (!navBlock) return false;
  return raw.some(
    (r) =>
      !!r &&
      typeof r === "object" &&
      Array.isArray((r as { blockIds?: unknown }).blockIds) &&
      ((r as { blockIds: unknown[] }).blockIds as unknown[]).includes(navBlock.id),
  );
}
