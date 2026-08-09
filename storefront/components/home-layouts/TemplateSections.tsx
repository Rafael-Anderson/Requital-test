"use client";

import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { getHomepageTemplates } from "@/lib/api";
import type { HomepageTemplateSection } from "@/lib/types";
import ProductCard from "@/components/ProductCard";

// Storefront Home tab, 'templates' mode (see themesettings.homeTabMode) —
// one section per active Template, each showing that Template's own
// resolved (server-capped) product list. A Template with zero resolved
// products (e.g. a COLLECTION_GROUP whose member Collections are all empty)
// renders nothing rather than an empty section header.
export function sectionsWithProducts(sections: HomepageTemplateSection[]): HomepageTemplateSection[] {
  return sections.filter((s) => s.products.length > 0);
}

export default function TemplateSections() {
  const { shopSlug, outlets } = useShop();
  const [sections, setSections] = useState<HomepageTemplateSection[] | null>(null);
  const defaultOutletId = outlets[0]?.id;

  useEffect(() => {
    getHomepageTemplates(shopSlug, defaultOutletId)
      .then(setSections)
      .catch(() => setSections([]));
  }, [shopSlug, defaultOutletId]);

  const visible = sectionsWithProducts(sections ?? []);
  if (visible.length === 0) return null;

  return (
    <div className="space-y-10 sm:space-y-14 mb-10 sm:mb-14">
      {visible.map((section) => (
        <div key={section.id}>
          <h2 className="text-xl font-semibold mb-1">{section.title}</h2>
          {section.description && <p className="text-zinc-500 text-sm mb-4">{section.description}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-9 mt-4">
            {section.products.map((p) => (
              <ProductCard key={p.id} product={p} orientation="grid" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
