"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { listCollections, resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, resolveButtonElementStyle, themeTextPresetStyle } from "@/lib/theme-element-style";
import { selectTiles } from "@/components/home-layouts/FeaturedGrid";
import type { Collection } from "@/lib/types";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// Tailwind's JIT scanner needs literal class strings. Mobile stays 2-up.
const GRID_COLS: Record<number, string> = {
  2: "grid-cols-2 sm:grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-6",
};
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
  const { shopSlug, shopBasePath, previewToken, previewMode } = useShop();
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

  return (
    <div className="px-4 sm:px-6 theme-section-py mx-auto" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
      {(titleBlock?.visible !== false || viewAllBlock?.visible) && (
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
          {viewAllBlock?.visible && (
            <Link
              href={shopBasePath || "/"}
              {...editableAttrs(previewMode, { id: viewAllBlock.id, sectionId, type: "view_all_button" })}
              className="text-sm font-medium text-accent hover:underline"
              style={{
                textTransform: "var(--theme-button-text-transform, none)" as CSSProperties["textTransform"],
                ...resolveButtonElementStyle(viewAllBlock.settings),
              }}
            >
              {viewAllLabel}
            </Link>
          )}
        </div>
      )}
      <div className={`grid ${gridCols} gap-3`}>
        {tiles.map((c, i) => (
          <Link
            key={c.id}
            href={`${shopBasePath}/collections/${c.slug}`}
            className="group overflow-hidden border border-stroke theme-stagger-child"
            style={{ borderRadius: "var(--theme-radius, 8px)", "--i": i } as CSSProperties}
          >
            <div className={`relative ${aspect} bg-black/5 overflow-hidden`}>
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
