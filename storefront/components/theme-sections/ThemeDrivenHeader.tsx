"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { ShoppingCart, User } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useCartDrawer } from "@/lib/cart-drawer";
import { resolveImageUrl } from "@/lib/api";
import SearchBar from "@/components/SearchBar";
import type { Customer, Shop } from "@/lib/types";
import type { HeaderFooterConfig } from "@/lib/theme-config-types";

// Global chrome — pinned to every page, not part of the reorderable
// sections list (see the plan's scope decision). Fixed left-logo/
// right-icons layout for now; per-element freeform positioning (logo/nav/
// search/cart/account across left/center/right zones) is Phase 6.
// `transparentOnHero` is collected in the admin settings panel (Phase 2)
// but not yet visually wired here — flagged, not silently dropped.
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

  return (
    <div className={`${sticky ? "sticky top-0 z-30" : ""} border-b border-stroke`} style={style}>
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4">
        <Link href={shopBasePath || "/"} className="flex items-center gap-2 min-w-0">
          {shop?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveImageUrl(shop.logoUrl) ?? undefined}
              alt={shop?.displayName ?? shop?.name}
              className="h-8 max-w-40 object-contain shrink-0"
            />
          ) : (
            <span className="font-semibold text-lg truncate">{shop?.displayName ?? shop?.name ?? shopSlug}</span>
          )}
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          <SearchBar />
          {!shop?.disableStoreCart &&
            (shop?.cartLayout === "drawer" ? (
              <button type="button" onClick={openDrawer} aria-label="Open cart" className={`${cartButtonClass} cursor-pointer`}>
                {cartContent}
              </button>
            ) : (
              <Link href={`${shopBasePath}/cart`} className={cartButtonClass}>
                {cartContent}
              </Link>
            ))}
          <Link
            href={customer ? `${shopBasePath}/account` : `${shopBasePath}/account/login`}
            title={customer ? `Signed in as ${customer.name}` : "Sign in"}
            className="flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors"
          >
            <User className="size-5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
