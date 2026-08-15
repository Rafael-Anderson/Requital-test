"use client";

import { useParams } from "next/navigation";
import { ShopProvider, useShop } from "@/lib/shop-context";
import { CartProvider, useCart } from "@/lib/cart";
import { AuthProvider, useAuth } from "@/lib/auth";
import { CartDrawerProvider } from "@/lib/cart-drawer";
import { resolveImageUrl } from "@/lib/api";
import MenuBar from "@/components/MenuBar";
import TopBar from "@/components/TopBar";
import CartDrawer from "@/components/CartDrawer";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import AnnouncementBar from "@/components/AnnouncementBar";
import Footer from "@/components/Footer";
import WhatsAppFloatingButton from "@/components/WhatsAppFloatingButton";
import CookieConsentBanner from "@/components/CookieConsentBanner";
import type { Shop } from "@/lib/types";

// Whether the MenuBar row shows: a themed shop's own nav_menu header block
// visibility wins (set in the builder's Header tree node), falling back to
// the legacy shop.showCollectionMenu toggle for a shop with no published
// new-system theme.
function showMenuBar(shop: ReturnType<typeof useShop>["shop"], themeConfig: ReturnType<typeof useShop>["themeConfig"]) {
  if (themeConfig?.header) {
    return themeConfig.header.blocks.some((b) => b.type === "nav_menu" && b.visible);
  }
  return shop?.showCollectionMenu !== false;
}

function Header() {
  const { shopSlug, shop, themeConfig } = useShop();
  const { count } = useCart();
  const { customer } = useAuth();

  return (
    <header className="border-b border-stroke bg-header text-header-fg">
      <AnnouncementBar />
      <TopBar shopSlug={shopSlug} shop={shop} customer={customer} count={count} />
      {showMenuBar(shop, themeConfig) && <MenuBar />}
      {shop?.cartLayout === "drawer" && <CartDrawer />}
    </header>
  );
}

// Rendered instead of {children} for a shop that exists but hasn't been
// published yet (shop.published === false) — see backend
// PublicService.assertPublished. Every content endpoint (products,
// collections, checkout, ...) already 404s server-side for these shops
// regardless of what this page does; this is just the friendlier UI for
// that same gate, and — since {children} is never mounted in this branch —
// none of the page components underneath ever fire their data-fetching
// effects either.
function ComingSoon({ shop }: { shop: Shop }) {
  return (
    <div className="flex flex-col items-center text-center">
      {shop.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolveImageUrl(shop.logoUrl) ?? undefined} alt={shop.displayName ?? shop.name} className="h-12 max-w-48 object-contain mb-4" />
      )}
      <h1 className="text-2xl font-semibold mb-2">{shop.displayName ?? shop.name}</h1>
      <p className="text-zinc-500">This store is being set up and isn&apos;t open yet. Please check back soon.</p>
    </div>
  );
}

// No width/padding of its own — every page decides its own width via
// StorefrontPageShell (see that component), which is what lets a hero
// section render truly edge to edge while an account/checkout page still
// gets a sensibly capped, centered column. Previously a single blanket
// max-w-6xl wrapper here capped literally everything, including hero
// banners that should bleed to the viewport edge, while giving narrow forms
// no positioning of their own beyond hugging that box's left edge.
// Already length/reject-list validated server-side at save time (see
// backend theme-config.validation.ts's assertValidCustomCss) — no
// client-side re-sanitization here beyond that.
function CustomCss() {
  const { themeConfig } = useShop();
  const css = themeConfig?.globalSettings.customCss.css;
  if (!css) return null;
  return <style>{css}</style>;
}

function Body({ children }: { children: React.ReactNode }) {
  const { shop, loading } = useShop();

  if (!loading && shop && !shop.published) {
    return (
      <>
        <CustomCss />
        <Header />
        <main>
          <StorefrontPageShell variant="narrow">
            <ComingSoon shop={shop} />
          </StorefrontPageShell>
        </main>
      </>
    );
  }

  return (
    <>
      <CustomCss />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <WhatsAppFloatingButton />
      <CookieConsentBanner />
    </>
  );
}

// Client shell (hooks/context need a client boundary) — kept as a plain
// component, not the route's layout.tsx file itself, so the actual
// app/[shop]/layout.tsx can stay a Server Component and export
// generateMetadata (per-tenant title/favicon; a "use client" file can't).
export default function ShopLayoutClient({ children }: { children: React.ReactNode }) {
  const params = useParams<{ shop: string }>();
  const shopSlug = params.shop;

  return (
    <ShopProvider shopSlug={shopSlug}>
      <AuthProvider shopSlug={shopSlug}>
        <CartProvider shopSlug={shopSlug}>
          {/* Always mounted, regardless of theme.cartLayout — TopBar's cart
              icon calls useCartDrawer() unconditionally (see components/
              TopBar.tsx) so the context must exist even for shops using the
              full-page cart, where it's simply never opened. */}
          <CartDrawerProvider>
            <Body>{children}</Body>
          </CartDrawerProvider>
        </CartProvider>
      </AuthProvider>
    </ShopProvider>
  );
}
