"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, Phone, PackageSearch, ShoppingCart, User, X } from "lucide-react";
import { resolveImageUrl } from "@/lib/api";
import { iconStyleProps } from "@/lib/icon-style";
import { useCartDrawer } from "@/lib/cart-drawer";
import { useShop } from "@/lib/shop-context";
import SearchBar from "@/components/SearchBar";
import ThemeDrivenHeader from "@/components/theme-sections/ThemeDrivenHeader";
import type { Customer, Density, Shop } from "@/lib/types";

// Height/padding only — independent of which of the 3 layout variants below
// renders, so any arrangement can pair with any density (see schema.prisma's
// comment on themesettings.headerDensity).
const DENSITY_PADDING: Record<Density, string> = {
  compact: "py-1.5",
  regular: "py-3",
  spacious: "py-5",
};
function headerPadding(shop: Shop | null) {
  return DENSITY_PADDING[shop?.headerDensity ?? "regular"];
}

interface TopBarProps {
  shopSlug: string;
  shop: Shop | null;
  customer: Customer | null;
  count: number;
}

function Logo({ shopSlug, shop }: { shopSlug: string; shop: Shop | null }) {
  const { shopBasePath } = useShop();
  return (
    <Link href={shopBasePath || "/"} className="flex items-center gap-2 min-w-0">
      {shop?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolveImageUrl(shop.logoUrl) ?? undefined} alt={shop.displayName ?? shop.name} className="h-8 max-w-40 object-contain shrink-0" />
      ) : (
        <span className="font-semibold text-lg truncate">{shop?.displayName ?? shop?.name ?? shopSlug}</span>
      )}
    </Link>
  );
}

// Always calls useCartDrawer() (context is always mounted in
// ShopLayoutClient, regardless of cartLayout) so this never conditionally
// calls a hook — only the click behavior/element type branches on
// theme.cartLayout, never the hook call itself.
function CartIconButton({ shop, count }: { shop: Shop | null; count: number }) {
  const { shopBasePath } = useShop();
  const { openDrawer } = useCartDrawer();
  // Guarded here (the one place every layout's cart icon renders through),
  // not per call site — see ProductDetailClient.tsx for the matching
  // PDP-side buy-now/contact-to-order CTA swap.
  if (shop?.disableStoreCart) return null;
  const iconProps = iconStyleProps(shop?.iconStyle, 1.75);
  const className = "relative flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors";
  const content = (
    <>
      <ShoppingCart className="size-5" {...iconProps} />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-medium">{count}</span>
      )}
    </>
  );

  if (shop?.cartLayout === "drawer") {
    return (
      <button type="button" onClick={openDrawer} aria-label="Open cart" className={`${className} cursor-pointer`}>
        {content}
      </button>
    );
  }
  return (
    <Link href={`${shopBasePath}/cart`} className={className}>
      {content}
    </Link>
  );
}

function NavIcons({ shop, customer, count, showPhone = true, showAccount = true }: TopBarProps & { showPhone?: boolean; showAccount?: boolean }) {
  const { shopBasePath } = useShop();
  const contactNumber = shop?.contactNumbers?.[0];
  const iconProps = iconStyleProps(shop?.iconStyle, 1.75);

  return (
    <div className="flex items-center gap-1 shrink-0">
      {showPhone && contactNumber && (
        <a href={`tel:${contactNumber}`} title={`Call ${contactNumber}`} className="flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors">
          <Phone className="size-5" {...iconProps} />
        </a>
      )}
      <Link href={`${shopBasePath}/orders/track`} title="Track an order" className="flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors">
        <PackageSearch className="size-5" {...iconProps} />
      </Link>
      {showAccount && (
        <Link
          href={customer ? `${shopBasePath}/account` : `${shopBasePath}/account/login`}
          title={customer ? `Signed in as ${customer.name}` : "Sign in"}
          className="flex items-center gap-1.5 px-2 h-9 rounded-full hover:bg-mouse-over/10 transition-colors"
        >
          <User className="size-5" {...iconProps} />
          {customer && <span className="hidden sm:inline text-sm max-w-24 truncate">{customer.name}</span>}
        </Link>
      )}
      <SearchBar />
      <CartIconButton shop={shop} count={count} />
    </div>
  );
}

function TopBarLogoLeft(props: TopBarProps) {
  return (
    <div className={`mx-auto max-w-7xl px-4 ${headerPadding(props.shop)} flex items-center justify-between gap-4`}>
      <Logo shopSlug={props.shopSlug} shop={props.shop} />
      <NavIcons {...props} />
    </div>
  );
}

function TopBarLogoCenter(props: TopBarProps) {
  const iconProps = iconStyleProps(props.shop?.iconStyle, 1.75);
  const contactNumber = props.shop?.contactNumbers?.[0];
  return (
    <div className={`mx-auto max-w-7xl px-4 ${headerPadding(props.shop)} grid grid-cols-3 items-center gap-4`}>
      <div className="flex items-center gap-1">
        {contactNumber && (
          <a href={`tel:${contactNumber}`} title={`Call ${contactNumber}`} className="flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors">
            <Phone className="size-5" {...iconProps} />
          </a>
        )}
      </div>
      <div className="flex justify-center min-w-0">
        <Logo shopSlug={props.shopSlug} shop={props.shop} />
      </div>
      <div className="flex justify-end">
        <NavIcons {...props} showPhone={false} />
      </div>
    </div>
  );
}

function TopBarMinimal(props: TopBarProps) {
  const { shopBasePath } = useShop();
  const [menuOpen, setMenuOpen] = useState(false);
  const iconProps = iconStyleProps(props.shop?.iconStyle, 1.75);

  return (
    <div className={`mx-auto max-w-7xl px-4 ${headerPadding(props.shop)}`}>
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors cursor-pointer"
        >
          {menuOpen ? <X className="size-5" {...iconProps} /> : <Menu className="size-5" {...iconProps} />}
        </button>
        <Logo shopSlug={props.shopSlug} shop={props.shop} />
        <div className="flex items-center gap-1">
          <SearchBar />
          <CartIconButton shop={props.shop} count={props.count} />
        </div>
      </div>
      {menuOpen && (
        <div className="flex flex-col gap-1 pt-2 mt-2 border-t border-stroke">
          {props.shop?.contactNumbers?.[0] && (
            <a href={`tel:${props.shop.contactNumbers[0]}`} className="flex items-center gap-2 py-2 text-sm hover:text-accent">
              <Phone className="size-4" {...iconProps} /> Call {props.shop.contactNumbers[0]}
            </a>
          )}
          <Link href={`${shopBasePath}/orders/track`} className="flex items-center gap-2 py-2 text-sm hover:text-accent" onClick={() => setMenuOpen(false)}>
            <PackageSearch className="size-4" {...iconProps} /> Track an order
          </Link>
          <Link
            href={props.customer ? `${shopBasePath}/account` : `${shopBasePath}/account/login`}
            className="flex items-center gap-2 py-2 text-sm hover:text-accent"
            onClick={() => setMenuOpen(false)}
          >
            <User className="size-4" {...iconProps} /> {props.customer ? props.customer.name : "Sign in"}
          </Link>
        </div>
      )}
    </div>
  );
}

// theme.topBarLayout dispatch — three real header structures (not the same
// markup with a CSS tweak), all sharing the same Logo/NavIcons/CartIconButton
// pieces so a color/icon-style/button-style change stays consistent across
// every one. Requires CartDrawerProvider to already be mounted above this
// (see ShopLayoutClient) regardless of cartLayout — CartIconButton always
// calls useCartDrawer(), never conditionally.
export default function TopBar(props: TopBarProps) {
  // New visual theme builder's global header chrome, checked first — falls
  // through to the existing legacy dispatch unchanged when the shop has no
  // published new-system theme (themeConfig is null). See shop-context.tsx.
  const { themeConfig } = useShop();
  if (themeConfig?.header) {
    return (
      <ThemeDrivenHeader
        shopSlug={props.shopSlug}
        shop={props.shop}
        customer={props.customer}
        count={props.count}
        config={themeConfig.header}
      />
    );
  }

  const layout = props.shop?.topBarLayout ?? "logo_left";
  if (layout === "logo_center") return <TopBarLogoCenter {...props} />;
  if (layout === "minimal") return <TopBarMinimal {...props} />;
  return <TopBarLogoLeft {...props} />;
}
