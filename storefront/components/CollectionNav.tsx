"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { listCollections } from "@/lib/api";
import type { Collection } from "@/lib/types";

// Mobile-only scroll-nudge arrows for this row — the "Collection Slider
// Arrow Color"/"Active Color" Appearance Color fields (Theme Customizer)
// were saved-but-unwired since no element resembling a "collection slider"
// existed; this scrollable pill row is the closest real match, and the
// fields' own labels already say "(mobile view)". Desktop relies on the
// existing native horizontal scroll/wheel — no arrows needed there.
const ARROW_CLASS =
  "sm:hidden shrink-0 flex items-center justify-center size-7 rounded-full text-[var(--color-collection-arrow)] hover:text-[var(--color-collection-arrow-active)] transition-colors cursor-pointer";

export default function CollectionNav() {
  const { shopSlug, shopBasePath, previewToken } = useShop();
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

  return (
    <nav className="border-t border-stroke">
      <div className="mx-auto max-w-7xl px-2 sm:px-4 flex items-center gap-1">
        <button type="button" onClick={() => scrollByAmount(-120)} aria-label="Scroll collections left" className={ARROW_CLASS}>
          <ChevronLeft className="size-4" />
        </button>
        <div ref={scrollRef} className="flex items-center gap-1 overflow-x-auto py-2 text-sm scroll-smooth">
          <Link
            href={shopBasePath || "/"}
            className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
              !activeSlug ? "bg-accent text-accent-foreground" : "text-zinc-600 hover:bg-mouse-over/10"
            }`}
          >
            Home
          </Link>
          {collections.map((c) => (
            <Link
              key={c.id}
              href={`${shopBasePath}/collections/${c.slug}`}
              className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                activeSlug === c.slug ? "bg-accent text-accent-foreground" : "text-zinc-600 hover:bg-mouse-over/10"
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>
        <button type="button" onClick={() => scrollByAmount(120)} aria-label="Scroll collections right" className={ARROW_CLASS}>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </nav>
  );
}
