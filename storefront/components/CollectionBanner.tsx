"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { bannerHeightVars, resolveBannerHeights } from "@/lib/banner-height";
import type { CollectionPageSettings } from "@/lib/theme-config-types";

// The collection page's heading area.
// - WITH a banner image: the image banner (height from collectionPage.bannerHeight /
//   bannerHeightMobile, default 220 on every viewport as before), title over it.
// - WITHOUT an image: no banner area at all (no empty tinted block). The same
//   breadcrumb, title and description render as a plain block with its own
//   alignment and spacing (collectionPage.titleAlign / titleSpacing).
export const DEFAULT_BANNER_HEIGHT = 220;
export const DEFAULT_TITLE_SPACING = 24;

export default function CollectionBanner({
  name,
  description,
  parent,
  bannerImage,
  shopBasePath,
  settings,
}: {
  name: string;
  description: string | null | undefined;
  parent?: { name: string; slug: string };
  bannerImage: string | undefined | null;
  shopBasePath: string;
  settings?: Partial<CollectionPageSettings>;
}) {
  const hasImage = !!bannerImage;
  const crumbs = (
    <nav className={`text-xs mb-2 ${hasImage ? "text-white/80" : "text-zinc-500"}`}>
      <Link href={shopBasePath || "/"} className="hover:underline">
        Home
      </Link>
      {parent && (
        <>
          {" / "}
          <Link href={`${shopBasePath}/collections/${parent.slug}`} className="hover:underline">
            {parent.name}
          </Link>
        </>
      )}
      {" / "}
      <span>{name}</span>
    </nav>
  );

  if (!hasImage) {
    const align = settings?.titleAlign ?? "start";
    const spacing =
      typeof settings?.titleSpacing === "number" ? settings.titleSpacing : DEFAULT_TITLE_SPACING;
    const textAlign: CSSProperties["textAlign"] = align;
    const descPlacement = align === "center" ? "mx-auto" : align === "end" ? "ms-auto" : "";
    return (
      <div
        data-testid="collection-title-block"
        className="w-full"
        style={{ paddingBlock: spacing }}
      >
        <div
          className="mx-auto w-full px-4 sm:px-6"
          style={{ maxWidth: "var(--theme-max-width, 80rem)", textAlign }}
        >
          {crumbs}
          <h1 className="text-[32px] font-extrabold leading-tight text-product-name">{name}</h1>
          {description && (
            <p className={`mt-1 text-[15px] max-w-2xl text-zinc-600 ${descPlacement}`}>{description}</p>
          )}
        </div>
      </div>
    );
  }

  const heights = resolveBannerHeights(
    settings?.bannerHeight,
    settings?.bannerHeightMobile,
    DEFAULT_BANNER_HEIGHT,
  )!;
  return (
    <div
      data-testid="collection-banner"
      className="relative w-full flex items-end h-[var(--banner-h)] md:h-[var(--banner-h-md)]"
      style={bannerHeightVars(heights) as CSSProperties}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={bannerImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative mx-auto w-full px-4 sm:px-6 pb-6" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
        {crumbs}
        <h1 className="text-[32px] font-extrabold leading-tight text-white">{name}</h1>
        {description && <p className="mt-1 text-[15px] max-w-2xl text-white/85">{description}</p>}
      </div>
    </div>
  );
}
