"use client";

import Link from "next/link";
import { resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveImageBlockWrapperStyle } from "@/lib/theme-element-style";
import type { ThemeBlock } from "@/lib/theme-config-types";

// Standalone "Image" block content (storefront-v2 Phase 4B) — shared by
// every section this block type is now valid in (Header, Footer, Hero,
// Rich Text; Image+Text already had its own dedicated image-half
// rendering before this and is untouched). Renders nothing when the
// merchant hasn't uploaded an image yet, same "no placeholder" convention
// every other block in this codebase follows.
export default function ThemeImageBlock({
  block,
  sectionId,
  previewMode,
}: {
  block: ThemeBlock;
  sectionId: string;
  previewMode: boolean;
}) {
  const imageUrl = resolveImageUrl((block.settings.imageUrl as string) ?? null);
  if (!imageUrl) return null;
  const alt = (block.settings.alt as string) ?? "";
  const linkUrl = block.settings.linkUrl as string | undefined;

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt={alt} className="w-full h-auto" />
  );

  return (
    <div style={resolveImageBlockWrapperStyle(block.settings)} {...editableAttrs(previewMode, { id: block.id, sectionId, type: "image" })}>
      {linkUrl ? (
        <Link href={linkUrl} className="block">
          {img}
        </Link>
      ) : (
        img
      )}
    </div>
  );
}
