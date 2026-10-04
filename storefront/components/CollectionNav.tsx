"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { listCollections } from "@/lib/api";
import { resolveNavLinkStyle } from "@/lib/nav-menu-style";
import type { Collection } from "@/lib/types";

// Mobile-only scroll-nudge arrows for this row — the "Collection Slider
// Arrow Color"/"Active Color" Appearance Color fields (Theme Customizer)
// were saved-but-unwired since no element resembling a "collection slider"
// existed; this scrollable pill row is the closest real match, and the
// fields' own labels already say "(mobile view)". Desktop relies on the
// existing native horizontal scroll/wheel — no arrows needed there.
const ARROW_CLASS =
  "sm:hidden shrink-0 flex items-center justify-center size-7 rounded-full text-[var(--color-collection-arrow)] hover:text-[var(--color-collection-arrow-active)] transition-colors cursor-pointer";

// A themed shop's chevrons follow the header text colour instead of the legacy teal Appearance Color default,
// which on the starter templates is a Requital accent no template uses.
const ARROW_CLASS_THEMED =
  "sm:hidden shrink-0 flex items-center justify-center size-7 rounded-full opacity-70 hover:opacity-100 transition-opacity cursor-pointer";

// `inline`: rendered inside a header row (MenuBar passes it through when it has no configured menu items to
// show) instead of as the full-width bar under the header. An inline copy keeps no border or page-width wrapper
// and may shrink to its cell (min-w-0); without that a bar built for the full width overflowed its grid cell on
// top of the logo and icons (Heritage at 360px).
export default function CollectionNav({ inline = false }: { inline?: boolean } = {}) {
  const { shopSlug, shopBasePath, previewToken, themeConfig } = useShop();
  // The nav_menu block's link treatment applies to this auto-generated list too (it used to ignore it, so
  // an Atelier or Heritage shop with no configured menu got today's default grey pills in any header colour).
  const navBlock = themeConfig?.header.blocks.find((b) => b.type === "nav_menu");
  const navLinkStyle = resolveNavLinkStyle(navBlock?.settings.style as string | undefined);
  const defaultStyle = navBlock?.settings.style === undefined || navBlock.settings.style === "pill";
  const pathname = usePathname();
  const relativePathname = shopBasePath ? pathname.slice(shopBasePath.length) : pathname;
  const activeSlug = relativePathname.startsWith("/collections/")
    ? relativePathname.slice("/collections/".length)
    : null;
  const [collections, setCollections] = useState<Collection[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listCollections(shopSlug, previewToken)
      .then((all) => setCollections(all.filter((c) => c.parentCollectionId === null)))
      .catch(() => setCollections([]));
  }, [shopSlug, previewToken]);

  if (collections.length === 0) return null;

  function scrollByAmount(amount: number) {
    scrollRef.current?.scrollBy({ left: amount, behavior: "smooth" });
  }

  const arrowClass = themeConfig ? ARROW_CLASS_THEMED : ARROW_CLASS;
  const Wrapper = inline ? "div" : "nav";
  return (
    <Wrapper className={inline ? "min-w-0" : "border-t border-stroke"} style={navLinkStyle.useHeadingFont ? { fontFamily: "var(--theme-heading-font, inherit)" } : undefined}>
      <div className={inline ? "flex items-center gap-1 min-w-0" : "mx-auto max-w-7xl px-2 sm:px-4 flex items-center gap-1"}>
        <button type="button" onClick={() => scrollByAmount(-120)} aria-label="Scroll collections left" className={arrowClass}>
          <ChevronLeft className="size-4" />
        </button>
        <div ref={scrollRef} className="flex items-center gap-1 overflow-x-auto py-2 text-sm scroll-smooth min-w-0">
          {collections.map((c) => (
            <Link
              key={c.id}
              href={`${shopBasePath}/collections/${c.slug}`}
              aria-current={activeSlug === c.slug ? "page" : undefined}
              className={
                defaultStyle
                  ? `px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                      activeSlug === c.slug ? "bg-accent text-accent-foreground" : "text-zinc-600 hover:bg-mouse-over/10"
                    }`
                  : `whitespace-nowrap ${navLinkStyle.className} ${activeSlug === c.slug ? "opacity-100! font-semibold" : ""}`
              }
            >
              {c.name}
            </Link>
          ))}
        </div>
        <button type="button" onClick={() => scrollByAmount(120)} aria-label="Scroll collections right" className={arrowClass}>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </Wrapper>
  );
}
