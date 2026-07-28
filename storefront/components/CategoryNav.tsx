"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { listCategories } from "@/lib/api";
import type { Category } from "@/lib/types";

// Mobile-only scroll-nudge arrows for this row — the "Category Slider
// Arrow Color"/"Active Color" Appearance Color fields (Theme Customizer)
// were saved-but-unwired since no element resembling a "category slider"
// existed; this scrollable pill row is the closest real match, and the
// fields' own labels already say "(mobile view)". Desktop relies on the
// existing native horizontal scroll/wheel — no arrows needed there.
const ARROW_CLASS =
  "sm:hidden shrink-0 flex items-center justify-center size-7 rounded-full text-[var(--color-category-arrow)] hover:text-[var(--color-category-arrow-active)] transition-colors cursor-pointer";

export default function CategoryNav() {
  const { shopSlug } = useShop();
  const searchParams = useSearchParams();
  const activeCategoryId = searchParams.get("category");
  const [categories, setCategories] = useState<Category[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listCategories(shopSlug)
      .then((all) => setCategories(all.filter((c) => c.parentCategoryId === null)))
      .catch(() => setCategories([]));
  }, [shopSlug]);

  if (categories.length === 0) return null;

  function scrollByAmount(amount: number) {
    scrollRef.current?.scrollBy({ left: amount, behavior: "smooth" });
  }

  return (
    <nav className="border-t border-stroke">
      <div className="mx-auto max-w-7xl px-2 sm:px-4 flex items-center gap-1">
        <button type="button" onClick={() => scrollByAmount(-120)} aria-label="Scroll categories left" className={ARROW_CLASS}>
          <ChevronLeft className="size-4" />
        </button>
        <div ref={scrollRef} className="flex items-center gap-1 overflow-x-auto py-2 text-sm scroll-smooth">
          <Link
            href={`/${shopSlug}`}
            className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
              !activeCategoryId ? "bg-accent text-accent-foreground" : "text-zinc-600 hover:bg-mouse-over/10"
            }`}
          >
            All
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/${shopSlug}?category=${c.id}`}
              className={`px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                activeCategoryId === String(c.id) ? "bg-accent text-accent-foreground" : "text-zinc-600 hover:bg-mouse-over/10"
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>
        <button type="button" onClick={() => scrollByAmount(120)} aria-label="Scroll categories right" className={ARROW_CLASS}>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </nav>
  );
}
