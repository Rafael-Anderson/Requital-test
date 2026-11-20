// The desktop mega menu's group layout (MenuBar.tsx's wide MegaMenuPanel). Pure, so the packing
// rules are unit-tested without a browser.
//
// Columns: as many tracks as fit the panel's content width, each at least MEGA_TRACK_MIN wide (a
// typical group name and its links stay readable) and at most MEGA_TRACK_MAX (a 2560px screen does
// not stretch eight groups into absurdly wide columns). Space that cannot hold another full track is
// left empty at the end of the row rather than squashing the columns.
//
// Packing (masonry): groups keep the merchant's order and each one goes into the column that is
// currently shortest (the start-most one on a tie), so a group that would start a "second row" moves
// up into the space under a shorter group instead of leaving a gap. Only the visual placement
// changes: the DOM, and therefore keyboard and screen-reader order, stays the merchant's order.

export const MEGA_TRACK_MIN = 220; // 13.75rem
export const MEGA_TRACK_MAX = 280; // 17.5rem
export const MEGA_COLUMN_GAP = 32; // 2rem, the gap the old panel used between groups
export const MEGA_ROW_GAP = 24; // 1.5rem between two groups stacked in one column

export interface MegaColumns {
  cols: number;
  track: number;
}

/** How many tracks fit `width` px of content, and how wide each one is. */
export function megaColumns(width: number, min = MEGA_TRACK_MIN, max = MEGA_TRACK_MAX, gap = MEGA_COLUMN_GAP): MegaColumns {
  if (!(width > 0)) return { cols: 1, track: min };
  const cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
  // One column narrower than the minimum (a very narrow panel) takes the width it has.
  const fit = (width - (cols - 1) * gap) / cols;
  const track = Math.floor(Math.min(max, fit));
  return { cols, track };
}

export interface MegaPlacement {
  col: number;
  top: number;
}

/**
 * Places groups of the given heights into `cols` columns, each into the currently shortest column.
 * Returns each group's column and top offset (px, from the top of the group area) and the height of
 * the tallest column.
 */
export function packMegaGroups(heights: number[], cols: number, rowGap = MEGA_ROW_GAP): { placements: MegaPlacement[]; height: number } {
  const n = Math.max(1, Math.floor(cols));
  const bottoms = new Array<number>(n).fill(0);
  const used = new Array<boolean>(n).fill(false);
  const placements = heights.map((h) => {
    let col = 0;
    for (let c = 1; c < n; c++) if (bottoms[c] < bottoms[col]) col = c;
    const top = used[col] ? bottoms[col] + rowGap : 0;
    bottoms[col] = top + Math.max(0, h);
    used[col] = true;
    return { col, top };
  });
  return { placements, height: Math.max(0, ...bottoms) };
}

/** A placement's inline-start offset (px) inside the group area. */
export function megaColumnOffset(col: number, track: number, gap = MEGA_COLUMN_GAP): number {
  return col * (track + gap);
}
