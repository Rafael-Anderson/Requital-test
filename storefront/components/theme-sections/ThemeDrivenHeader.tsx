"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ShoppingCart, User } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useCartDrawer } from "@/lib/cart-drawer";
import { resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveImageElementStyle } from "@/lib/theme-element-style";
import SearchBar from "@/components/SearchBar";
import type { Customer, Shop } from "@/lib/types";
import type { HeaderFooterConfig, ThemeBlock } from "@/lib/theme-config-types";

const ZONES = ["left", "center", "right"] as const;

// Matches admin/lib/useThemeEditor.ts's HEADER_CHROME_ID by hand — same
// no-shared-package convention as every other cross-app constant. Only
// used as the data-requital-section grouping key for the in-preview
// selection/drag feature (PreviewInteraction.tsx); PreviewFrame.tsx's
// element-moved handler checks for this exact string.
const HEADER_CHROME_ID = "__header__";

// Global chrome — pinned to every page, not part of the reorderable
// sections list (see the plan's scope decision). Each block's own
// settings.zone (left/center/right, defaulting to left) places it in the
// 3-column header row. nav_menu has no zone rendering of its own here — the
// existing MenuBar row (ShopLayoutClient.tsx's Header()) already renders
// full-width below this component for both themed and legacy shops; that
// component reads this same config to decide whether to show it, so the
// block's visibility is still honored, just not by this file.
// `transparentOnHero` is collected in the admin settings panel but not yet
// visually wired here — flagged, not silently dropped.
export default function ThemeDrivenHeader({
  shopSlug,
  shop,
  customer,
  count,
  config,
}: {
  shopSlug: string;
  shop: Shop | null;
  customer: Customer | null;
  count: number;
  config: HeaderFooterConfig;
}) {
  const { shopBasePath, previewMode } = useShop();
  const { openDrawer } = useCartDrawer();
  const sticky = !!config.settings.sticky;
  const background = config.settings.background as Record<string, unknown> | undefined;

  const style: CSSProperties = {};
  if (background?.type === "solid" && typeof background.color === "string") {
    style.background = background.color;
  }

  const blocks = [...config.blocks].filter((b) => b.visible).sort((a, b) => a.order - b.order);

  const cartButtonClass =
    "relative flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors";
  const cartContent = (
    <>
      <ShoppingCart className="size-5" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-medium">
          {count}
        </span>
      )}
    </>
  );

  function renderBlock(block: ThemeBlock): ReactNode {
    switch (block.type) {
      case "logo":
        return (
          <Link
            key="logo"
            href={shopBasePath || "/"}
            {...editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "logo" })}
            className="flex items-center gap-2 min-w-0"
          >
            {shop?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolveImageUrl(shop.logoUrl) ?? undefined}
                alt={shop?.displayName ?? shop?.name}
                className="h-8 max-w-40 object-contain shrink-0"
                style={resolveImageElementStyle(block.settings)}
              />
            ) : (
              <span className="font-semibold text-lg truncate">
                {shop?.displayName ?? shop?.name ?? shopSlug}
              </span>
            )}
          </Link>
        );
      case "search_icon":
        return <SearchBar key="search" />;
      case "cart_icon":
        if (shop?.disableStoreCart) return null;
        return shop?.cartLayout === "drawer" ? (
          <button
            key="cart"
            type="button"
            onClick={openDrawer}
            aria-label="Open cart"
            className={`${cartButtonClass} cursor-pointer`}
          >
            {cartContent}
          </button>
        ) : (
          <Link key="cart" href={`${shopBasePath}/cart`} className={cartButtonClass}>
            {cartContent}
          </Link>
        );
      case "account_icon":
        return (
          <Link
            key="account"
            href={customer ? `${shopBasePath}/account` : `${shopBasePath}/account/login`}
            title={customer ? `Signed in as ${customer.name}` : "Sign in"}
            className="flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors"
          >
            <User className="size-5" />
          </Link>
        );
      default:
        return null;
    }
  }

  return (
    <div className={`${sticky ? "sticky top-0 z-30" : ""} border-b border-stroke`} style={style}>
      <div className="mx-auto max-w-7xl px-4 py-3 grid grid-cols-3 items-center gap-4">
        {ZONES.map((zone) => (
          <div
            key={zone}
            className={`flex items-center gap-1 ${zone === "left" ? "justify-start" : zone === "center" ? "justify-center" : "justify-end"}`}
          >
            {blocks
              .filter((b) => (b.settings.zone as string | undefined) === zone || (zone === "left" && !b.settings.zone))
              .map((b) => renderBlock(b))}
          </div>
        ))}
      </div>
    </div>
  );
}
