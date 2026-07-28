import type { IconStyle } from "./types";

// Two real, distinct renderings of the same lucide-react glyphs — not a
// second icon package. lucide's icons are authored as outline strokes, but
// filling them with currentColor and dropping the stroke to a hairline
// produces a genuinely different, "solid" silhouette rather than a CSS
// color swap on the same shape. Avoids adding a second icon dependency
// (e.g. Heroicons' separate outline/solid sets) for what this already does.
export function iconStyleProps(style: IconStyle | undefined, outlineStrokeWidth = 1.75) {
  if (style === "solid") {
    return { fill: "currentColor" as const, strokeWidth: 0.5 };
  }
  return { fill: "none" as const, strokeWidth: outlineStrokeWidth };
}
