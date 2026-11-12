// Which image represents a collection in a THUMBNAIL (anywhere except the collection's own page,
// which is the only place the banner `image` is the picture). A collection has two images: the Icon
// and the Banner. Every thumbnail surface prefers the Icon. When there is none:
//   - a rectangular tile or card falls back to the banner (a wide photo still reads as a tile);
//   - a circle falls back to the first letter, never the banner (a wide banner cropped into a
//     circle is what the Icon field exists to avoid).
type WithImages = { icon?: string | null; image?: string | null };

/** Rectangular tiles, grids, list thumbnails: Icon, else the banner, else nothing. */
export function collectionTileImage(c: WithImages | null | undefined): string | null {
  return c?.icon || c?.image || null;
}

/** Circles: the Icon only. Null means "show the first-letter placeholder". */
export function collectionCircleImage(c: WithImages | null | undefined): string | null {
  return c?.icon || null;
}
