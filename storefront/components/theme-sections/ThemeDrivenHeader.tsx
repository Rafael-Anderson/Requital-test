"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ShoppingCart, User } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useCartDrawer } from "@/lib/cart-drawer";
import { resolveImageUrl } from "@/lib/api";
import SearchBar from "@/components/SearchBar";
import type { Customer, Shop } from "@/lib/types";
import type { HeaderFooterConfig, ThemeElement } from "@/lib/theme-config-types";

// Mirrors admin/lib/default-theme-elements.ts's DEFAULT_HEADER_ELEMENTS by
// hand (no shared package) — used whenever a theme hasn't had its header
// elements dragged yet, so an untouched theme renders the same layout this
// component always rendered before Phase 6.
const DEFAULT_ELEMENTS: ThemeElement[] = [
  { id: "logo", type: "logo", position: { zone: "left" }, settings: {} },
  { id: "search", type: "search", position: { zone: "right" }, settings: {} },
  { id: "cart", type: "cart", position: { zone: "right" }, settings: {} },
  { id: "account", type: "account", position: { zone: "right" }, settings: {} },
];

const ZONES = ["left", "center", "right"] as const;

// Global chrome — pinned to every page, not part of the reorderable
// sections list (see the plan's scope decision). Renders each element
// (logo/search/cart/account) into whichever of the three zone columns its
// `position.zone` names — the admin's Phase 6 ElementDragZone is what
// actually writes non-default zones; an untouched theme's elements array is
// empty, so DEFAULT_ELEMENTS reproduces the original fixed layout exactly.
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
  const { shopBasePath } = useShop();
  const { openDrawer } = useCartDrawer();
  const sticky = !!config.settings.sticky;
  const background = config.settings.background as Record<string, unknown> | undefined;

  const style: CSSProperties = {};
  if (background?.type === "solid" && typeof background.color === "string") {
    style.background = background.color;
  }

  const elements = config.elements && config.elements.length > 0 ? config.elements : DEFAULT_ELEMENTS;

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

  function renderElement(type: string): ReactNode {
    switch (type) {
      case "logo":
        return (
          <Link key="logo" href={shopBasePath || "/"} className="flex items-center gap-2 min-w-0">
            {shop?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolveImageUrl(shop.logoUrl) ?? undefined}
                alt={shop?.displayName ?? shop?.name}
                className="h-8 max-w-40 object-contain shrink-0"
              />
            ) : (
              <span className="font-semibold text-lg truncate">
                {shop?.displayName ?? shop?.name ?? shopSlug}
              </span>
            )}
          </Link>
        );
      case "search":
        return <SearchBar key="search" />;
      case "cart":
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
      case "account":
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
            {elements
              .filter((el) => el.position.zone === zone)
              .map((el) => renderElement(el.type))}
          </div>
        ))}
      </div>
    </div>
  );
}
