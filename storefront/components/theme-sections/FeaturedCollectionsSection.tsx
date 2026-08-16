"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { listCollections, resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle, resolveButtonElementStyle } from "@/lib/theme-element-style";
import { selectTiles } from "@/components/home-layouts/FeaturedGrid";
import type { Collection } from "@/lib/types";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

// collection_header's own sub-blocks carry the section's title/"view all"
// copy — there's no separate section.settings.heading field anymore (see
// backend constants.ts's BLOCK_TYPES.featured_collections). No "browse all
// collections" index route exists in this app (only /collections/[slug]),
// so "view all" links home, where CollectionNav already lists every
// collection as a pill row.
export default function FeaturedCollectionsSection({ sectionId, blocks }: { sectionId: string; settings: SectionSettings; blocks: ThemeBlock[] }) {
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

  const tiles = selectTiles(collections);
  if (tiles.length === 0) return null;

  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      {(titleBlock?.visible !== false || viewAllBlock?.visible) && (
        <div className="flex items-center justify-between mb-4">
          {titleBlock?.visible !== false && (
            <h2
              className="text-xl font-semibold"
              {...(titleBlock ? editableAttrs(previewMode, { id: titleBlock.id, sectionId, type: "section_heading" }) : {})}
              style={titleBlock ? resolveTextElementStyle(titleBlock.settings) : undefined}
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map((c) => (
          <Link
            key={c.id}
            href={`${shopBasePath}/collections/${c.slug}`}
            className="group overflow-hidden border border-stroke"
            style={{ borderRadius: "var(--theme-radius, 8px)" }}
          >
            <div className="aspect-square bg-black/5 overflow-hidden">
              {c.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveImageUrl(c.image) ?? undefined}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs px-2 text-center">
                  {c.name}
                </div>
              )}
            </div>
            <p className="px-2 py-1.5 text-xs font-medium truncate">{c.name}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
