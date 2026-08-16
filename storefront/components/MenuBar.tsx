"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { getMenu } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveNavElementStyle } from "@/lib/theme-element-style";
import type { MenuItem } from "@/lib/types";
import CollectionNav from "@/components/CollectionNav";

// Matches admin/lib/useThemeEditor.ts's HEADER_CHROME_ID by hand — nav_menu
// is one of the header's own blocks (visibility only — see
// ThemeDrivenHeader.tsx's own comment on why this component, not that one,
// renders it), so its data-requital-section groups with the rest of the
// header for selection/drag purposes.
const HEADER_CHROME_ID = "__header__";

// The storefront top bar's merchant-configured "Menu" (Phase C) — direct
// Collection links plus Dropdowns (hover/focus panel listing several
// Collections). Falls back to the pre-existing CollectionNav pill list
// unchanged when the shop hasn't configured any menu items yet
// (backward-compatible default, matching every other opt-in theme feature's
// convention in this app — no merchant is forced to configure anything).
export default function MenuBar() {
  const { shopSlug, shopBasePath, previewToken, previewMode, themeConfig } = useShop();
  const [items, setItems] = useState<MenuItem[] | null>(null);

  useEffect(() => {
    getMenu(shopSlug, previewToken)
      .then(setItems)
      .catch(() => setItems([]));
  }, [shopSlug, previewToken]);

  if (items === null) return null;
  if (items.length === 0) return <CollectionNav />;

  const navBlock = themeConfig?.header.blocks.find((b) => b.type === "nav_menu");
  const navStyle = navBlock ? resolveNavElementStyle(navBlock.settings) : {};
  const showOnMobile = navBlock?.settings.showOnMobile !== false;
  const linkClass = "theme-nav-link px-3 py-1.5 rounded-full whitespace-nowrap text-zinc-600 hover:bg-mouse-over/10 transition-colors";

  return (
    <nav
      className={`border-t border-stroke ${showOnMobile ? "" : "hidden md:block"}`}
      style={navStyle}
      {...(navBlock ? editableAttrs(previewMode, { id: navBlock.id, sectionId: HEADER_CHROME_ID, type: "nav_menu" }) : {})}
    >
      <div className="mx-auto max-w-7xl px-2 sm:px-4 flex items-center gap-1 py-2 text-sm overflow-x-auto">
        <Link href={shopBasePath || "/"} className={linkClass}>
          Home
        </Link>
        {items.map((item) =>
          item.type === "LINK" ? (
            item.collection && (
              <Link key={item.id} href={`${shopBasePath}/collections/${item.collection.slug}`} className={linkClass}>
                {item.label}
              </Link>
            )
          ) : (
            <div key={item.id} className="relative group shrink-0">
              <button type="button" aria-haspopup="true" className={`${linkClass} cursor-pointer`}>
                {item.label}
              </button>
              <div className="absolute left-0 top-full z-20 hidden group-hover:block group-focus-within:block pt-1">
                <div className="min-w-48 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg py-2">
                  <span className="block px-3 pb-1 text-xs font-semibold text-zinc-400">{item.label}</span>
                  <ul className="space-y-0.5">
                    {item.collections.map((c) =>
                      c.collection ? (
                        <li key={c.collectionId}>
                          <Link
                            href={`${shopBasePath}/collections/${c.collection.slug}`}
                            className="block px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            {c.collection.name}
                          </Link>
                        </li>
                      ) : null,
                    )}
                  </ul>
                </div>
              </div>
            </div>
          ),
        )}
      </div>
    </nav>
  );
}
