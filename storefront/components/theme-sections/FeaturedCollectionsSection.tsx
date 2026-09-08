"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { listCollections, resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import {
  resolveTextElementStyle,
  resolveButtonElementStyle,
  resolveSecondaryButtonStyle,
  resolveButtonHoverClass,
  themeTextPresetStyle,
} from "@/lib/theme-element-style";
import { selectTiles } from "@/components/home-layouts/FeaturedGrid";
import type { Collection } from "@/lib/types";
import type { ButtonStyleSettings, SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// Tailwind's JIT scanner needs literal class strings. Mobile stays 2-up.
// 2-6 was the original range; 7-8 added for #9/#14 (large tiles stay
// capped here — the "up to 20 in one row" ask is the quick_icons style,
// which is a scroll row with no column grid).
const GRID_COLS: Record<number, string> = {
  2: "grid-cols-2 sm:grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-6",
  7: "grid-cols-2 sm:grid-cols-7",
  8: "grid-cols-2 sm:grid-cols-8",
};
// quick_icons ceiling — a scrollable strip of small circular category
// icons; more than this in one row stops being scannable.
const QUICK_ICONS_MAX = 20;
const ASPECT_CLASS: Record<string, string> = {
  square: "aspect-square",
  portrait: "aspect-[3/4]",
  landscape: "aspect-[4/3]",
};

// collection_header's own sub-blocks carry the section's title/"view all"
// copy — there's no separate section.settings.heading field anymore (see
// backend constants.ts's BLOCK_TYPES.featured_collections). No "browse all
// collections" index route exists in this app (only /collections/[slug]),
// so "view all" links home, where CollectionNav already lists every
// collection as a pill row.
export default function FeaturedCollectionsSection({ sectionId, settings, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
  const { shopSlug, shopBasePath, previewToken, previewMode, themeConfig } = useShop();
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    listCollections(shopSlug, previewToken)
      .then(setCollections)
      .catch(() => setCollections([]));
  }, [shopSlug, previewToken]);

  const headerBlock = blocks.find((b) => b.type === "collection_header" && b.visible);
  const titleBlock = headerBlock?.blocks?.find((b) => b.type === "collection_title");
  const viewAllBlock = headerBlock?.blocks?.find((b) => b.type === "view_all_button");
  const heading = (titleBlock?.visible && typeof titleBlock.settings.text === "string" && titleBlock.settings.text) || "Featured Collections";
  const viewAllLabel = (typeof viewAllBlock?.settings.label === "string" && viewAllBlock.settings.label) || "View all";

  // A merchant-chosen, ordered collectionIds list wins outright; otherwise
  // fall back to the auto "every top-level collection, featured-first" rule
  // (optionally capped by maxCollections), unchanged from before this
  // section had any picker — a theme saved before these settings existed
  // renders exactly as it did before.
  const collectionIds = Array.isArray(settings.collectionIds) ? (settings.collectionIds as string[]) : [];
  const maxCollections = typeof settings.maxCollections === "number" && settings.maxCollections > 0 ? settings.maxCollections : undefined;

  let tiles: Collection[];
  if (collectionIds.length > 0) {
    const byId = new Map(collections.map((c) => [String(c.id), c]));
    tiles = collectionIds.map((id) => byId.get(id)).filter((c): c is Collection => c !== undefined);
  } else {
    tiles = selectTiles(collections);
    if (maxCollections !== undefined) tiles = tiles.slice(0, maxCollections);
  }
  if (tiles.length === 0) return null;

  // Phase 4 — tile grid controls. All absent ⇒ the pre-existing
  // sm:grid-cols-4 / aspect-square / name-below layout.
  const gridCols = GRID_COLS[settings.columns as number] ?? GRID_COLS[4];
  const aspect = ASPECT_CLASS[settings.aspectRatio as string] ?? ASPECT_CLASS.square;
  const overlayText = settings.overlayText === true;
  // #9/#14 — "quick_icons": a compact scrollable row of small circular
  // category icons with a caption, instead of the large tile grid. Absent
  // / "tiles" ⇒ byte-identical to before.
  const quickIcons = settings.displayStyle === "quick_icons";

  const header = (titleBlock?.visible !== false || viewAllBlock?.visible) && (
    <div className="flex items-center justify-between theme-heading-gap">
      {titleBlock?.visible !== false && (
        <h2
          className="text-xl font-semibold"
          {...(titleBlock ? editableAttrs(previewMode, { id: titleBlock.id, sectionId, type: "section_heading" }) : {})}
          style={{ ...themeTextPresetStyle("h2"), ...(titleBlock ? resolveTextElementStyle(titleBlock.settings) : {}) }}
        >
          {heading}
        </h2>
      )}
      {viewAllBlock?.visible && <ViewAll block={viewAllBlock} label={viewAllLabel} href={shopBasePath || "/"} sectionId={sectionId} previewMode={previewMode} secondary={themeConfig?.globalSettings.buttons.secondary} />}
    </div>
  );

  if (quickIcons) {
    return (
      <div className="theme-gutter-x theme-section-py mx-auto" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
        {header}
        {/* Horizontal scroll, never wraps — the negative margin + padding
            lets the row bleed to the screen edge on mobile so a partial
            icon hints "scroll for more". */}
        <div className="flex gap-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-2 snap-x">
          {tiles.slice(0, QUICK_ICONS_MAX).map((c, i) => (
            <Link
              key={c.id}
              href={`${shopBasePath}/collections/${c.slug}`}
              className="group shrink-0 snap-start flex flex-col items-center gap-1.5 w-20 theme-stagger-child"
              style={{ "--i": i } as CSSProperties}
            >
              <div className="size-16 rounded-full overflow-hidden bg-black/5">
                {c.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolveImageUrl(c.image) ?? undefined} alt="" className="w-full h-full object-cover theme-hover-zoom" />
                ) : (
                  <span
                    className="w-full h-full flex items-center justify-center text-lg font-semibold uppercase"
                    style={{ background: "color-mix(in srgb, var(--color-accent) 12%, var(--background))" }}
                  >
                    {c.name.charAt(0)}
                  </span>
                )}
              </div>
              <span className="text-xs font-medium text-center leading-tight line-clamp-2">{c.name}</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="theme-gutter-x theme-section-py mx-auto" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
      {header}
      <div className={`grid ${gridCols} gap-3`}>
        {tiles.map((c, i) => (
          <Link
            key={c.id}
            href={`${shopBasePath}/collections/${c.slug}`}
            className="group overflow-hidden border border-stroke theme-stagger-child"
            style={{ borderRadius: "var(--theme-radius, 8px)", "--i": i } as CSSProperties}
          >
            {/* max-h caps the tile: a "shop by X" strip is navigation, not a
                hero — square/portrait aspects at 2-4 columns otherwise make
                each tile 300-850px tall. object-cover keeps the crop; only
                extreme configs are clamped. */}
            <div className={`relative ${aspect} max-h-[360px] bg-black/5 overflow-hidden`}>
              {c.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveImageUrl(c.image) ?? undefined}
                  alt=""
                  className="w-full h-full object-cover theme-hover-zoom"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs px-2 text-center">
                  {c.name}
                </div>
              )}
              {overlayText && (
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-2 text-xs font-medium text-white truncate">
                  {c.name}
                </span>
              )}
            </div>
            {!overlayText && <p className="px-2 py-1.5 text-xs font-medium truncate">{c.name}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}

// §8.13.C item 2 — the view_all_button. `style: 'button'` renders it as the
// outline secondary button (globalSettings.buttons.secondary + border-fill /
// press from §8.8's resolveButtonHoverClass); anything else ⇒ today's exact
// plain accent link, byte-for-byte.
function ViewAll({
  block,
  label,
  href,
  sectionId,
  previewMode,
  secondary,
}: {
  block: ThemeBlock;
  label: string;
  href: string;
  sectionId: string;
  previewMode: boolean;
  secondary: ButtonStyleSettings | undefined;
}) {
  const attrs = editableAttrs(previewMode, { id: block.id, sectionId, type: "view_all_button" });
  if (block.settings.style === "button") {
    const hover = resolveButtonHoverClass(secondary?.hoverEffect, secondary?.pressEffect);
    return (
      <a
        href={href}
        {...attrs}
        className={`inline-block px-5 py-2.5 text-sm font-medium ${hover.className}`}
        style={{ ...resolveSecondaryButtonStyle(secondary), ...resolveButtonElementStyle(block.settings) }}
      >
        {label}
        {hover.showIcon && <ArrowRight className="theme-btn-icon inline-block ml-1.5 size-4 align-[-3px]" aria-hidden="true" />}
      </a>
    );
  }
  return (
    <Link
      href={href}
      {...attrs}
      className="text-sm font-medium text-accent hover:underline"
      style={{
        textTransform: "var(--theme-button-text-transform, none)" as CSSProperties["textTransform"],
        ...resolveButtonElementStyle(block.settings),
      }}
    >
      {label}
    </Link>
  );
}
