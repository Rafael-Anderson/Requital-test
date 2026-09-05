"use client";

import type { CSSProperties } from "react";
import { useParams } from "next/navigation";
import { ShopProvider, useShop } from "@/lib/shop-context";
import { CartProvider, useCart } from "@/lib/cart";
import { AuthProvider, useAuth } from "@/lib/auth";
import { WishlistProvider } from "@/lib/wishlist";
import { CartDrawerProvider } from "@/lib/cart-drawer";
import { resolveImageUrl } from "@/lib/api";
import MenuBar from "@/components/MenuBar";
import MobileNav from "@/components/MobileNav";
import { navMenuInHeaderRow } from "@/lib/header-rows";
import { useHeaderScrollState } from "@/lib/use-header-scroll-state";
import TopBar from "@/components/TopBar";
import CartDrawer from "@/components/CartDrawer";
import StorefrontLoadingSkeleton from "@/components/StorefrontLoadingSkeleton";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import AnnouncementBar from "@/components/AnnouncementBar";
import Footer from "@/components/Footer";
import WhatsAppFloatingButton from "@/components/WhatsAppFloatingButton";
import FloatingCustomButtons from "@/components/FloatingCustomButtons";
import CookieConsentBanner from "@/components/CookieConsentBanner";
import PreviewInteraction from "@/components/PreviewInteraction";
import PreviewImageDragGuard from "@/components/PreviewImageDragGuard";
import type { Shop } from "@/lib/types";
import type { MobileNavMode } from "@/lib/theme-config-types";

// Whether the MenuBar row shows: a themed shop's own nav_menu header block
// visibility wins (set in the builder's Header tree node) *when that block
// actually exists* — falling back to the legacy shop.showCollectionMenu
// toggle both for a shop with no published new-system theme AND for one
// whose theme predates this block existing in DEFAULT_THEME_CONFIG (see
// backend constants.ts — every real theme created before nav_menu was added
// to the default header seed has no such block in its saved header.blocks
// at all, which used to read as "explicitly hidden" via .some() finding
// nothing, permanently hiding the menu for those shops regardless of what
// the merchant configured in the separate Menu Builder). Absence of the
// block is "no opinion," not "hidden" — only an existing block with
// visible: false is a real, merchant-made "hide this" choice.
function showMenuBar(shop: ReturnType<typeof useShop>["shop"], themeConfig: ReturnType<typeof useShop>["themeConfig"]) {
  const header = themeConfig?.header;
  const navBlock = header?.blocks.find((b) => b.type === "nav_menu");
  // Phase 3: nav_menu placed inside a header row renders inline there
  // (ThemeDrivenHeader) — the separate below-header bar must not also render.
  if (header && navMenuInHeaderRow(header.settings, header.blocks)) return false;
  if (navBlock) return navBlock.visible;
  return shop?.showCollectionMenu !== false;
}

// Lives on the nav_menu block's own settings (admin's NavElementSettings,
// ElementSettingsPanel.tsx) rather than a new header-level settings field —
// same reasoning as showMenuBar() above treating that block as the header's
// one style/visibility control point. Undefined (no block yet, or a block
// that predates this control) falls through to the existing bg-header
// class/color-scheme default, same "don't force a value onto shops that
// never touched this setting" pattern every other field on this block
// follows (see resolveNavElementStyle's own typeof guards).
function headerBackgroundColor(themeConfig: ReturnType<typeof useShop>["themeConfig"]): string | undefined {
  const navBlock = themeConfig?.header.blocks.find((b) => b.type === "nav_menu");
  const color = navBlock?.settings.headerBackgroundColor;
  return typeof color === "string" ? color : undefined;
}

// C1 — header.settings.separator: 'line' (absent/default, today's grey
// border-stroke or the theme-colour-aware color-mix above) | 'none' (drop
// the border entirely) | 'shadow' (a soft box-shadow instead of a border —
// for a header whose own background already reads as separated, e.g. a
// coloured band preset, where a hard line looks redundant).
function headerSeparatorStyle(themeConfig: ReturnType<typeof useShop>["themeConfig"], customHeaderBg: string | undefined) {
  const separator = (themeConfig?.header.settings.separator as string) || "line";
  if (separator === "none") return { className: "", style: {} as CSSProperties };
  if (separator === "shadow") {
    return { className: "", style: { boxShadow: "0 1px 0 0 rgba(0,0,0,0.06), 0 4px 12px -4px rgba(0,0,0,0.08)" } };
  }
  return {
    className: "border-b border-stroke",
    style: customHeaderBg ? { borderBottomColor: "color-mix(in srgb, currentColor 12%, transparent)" } : {},
  };
}

function Header() {
  const { shopSlug, shop, themeConfig } = useShop();
  const { count } = useCart();
  const { customer } = useAuth();
  const customHeaderBg = headerBackgroundColor(themeConfig);
  const separator = headerSeparatorStyle(themeConfig, customHeaderBg);
  // C1 — header.settings.announcementPosition: 'above' (absent/default,
  // today's position, before the logo/nav content) | 'below' (after the
  // nav, right above <main>) — still inside this <header> element (keeps it
  // part of sticky header chrome either way).
  const announcementBelow = themeConfig?.header.settings.announcementPosition === "below";
  // C2 — header.settings.mobileNav: 'scroll'/absent never mounts MobileNav
  // at all (zero DOM, zero fetch — MenuBar.tsx's horizontal-scroll row is
  // completely untouched, the byte-identical no-op path).
  const mobileNavMode = themeConfig?.header.settings.mobileNav as MobileNavMode | undefined;

  // §8.7 item 2 — header.settings.scrollBehavior. 'shrink'/'hide-on-scroll'/
  // 'reveal-on-hero' promote this whole <header> (announcement + top bar +
  // menu bar together) to sticky and own the hide/solid treatment HERE, not
  // in ThemeDrivenHeader.tsx — this element is where the header's real
  // opaque background lives (bg-header/customHeaderBg); ThemeDrivenHeader's
  // own inner div can't fake transparency on its own, since whatever shows
  // "through" it is just this same opaque ancestor. The plain 'sticky'
  // value (or the legacy bare `sticky` boolean) is untouched — it keeps
  // applying narrowly to ThemeDrivenHeader's own div only, exactly as
  // today, since that's meant to be a drop-in equivalent, not a redesign.
  const scrollBehavior = (themeConfig?.header.settings.scrollBehavior as string) || "";
  const transparentOnHero = !!themeConfig?.header.settings.transparentOnHero;
  const { hidden, solid } = useHeaderScrollState(scrollBehavior, transparentOnHero);
  const wholeHeaderSticky = scrollBehavior === "shrink" || scrollBehavior === "hide-on-scroll" || scrollBehavior === "reveal-on-hero";
  const isTransparent = scrollBehavior === "reveal-on-hero" && !solid;

  return (
    // relative + z-30 gives the header its own stacking context so it
    // always paints above <main>'s content, regardless of DOM order — a
    // section using scroll-animation's opacity/transform (see globals.css's
    // theme-anim-* classes) creates ITS OWN stacking context too, and
    // without this the header (which had no z-index of its own, hence no
    // context) could end up painted underneath it, hiding MenuBar's hover
    // dropdown (z-20, scoped to its own parent) behind that section.
    <header
      className={`${wholeHeaderSticky ? "sticky top-0" : "relative"} z-30 bg-header text-header-fg ${separator.className} ${hidden ? "theme-header-hidden" : ""}`}
      style={{
        backgroundColor: isTransparent ? "transparent" : customHeaderBg,
        ...(wholeHeaderSticky
          ? { transition: "background-color var(--motion-duration-base, 300ms) var(--motion-ease, ease), transform var(--motion-duration-base, 300ms) var(--motion-ease, ease)" }
          : {}),
        ...separator.style,
      }}
    >
      {!announcementBelow && <AnnouncementBar />}
      <TopBar shopSlug={shopSlug} shop={shop} customer={customer} count={count} />
      {showMenuBar(shop, themeConfig) && <MenuBar />}
      {shop?.cartLayout === "drawer" && <CartDrawer />}
      {announcementBelow && <AnnouncementBar />}
      {mobileNavMode && mobileNavMode !== "scroll" && <MobileNav mode={mobileNavMode} />}
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

// Already length/reject-list validated server-side at save time (see
// backend theme-config.validation.ts's assertValidCustomCss) — no
// client-side re-sanitization here beyond that.
function CustomCss() {
  const { themeConfig } = useShop();
  const css = themeConfig?.globalSettings.customCss.css;
  if (!css) return null;
  return <style>{css}</style>;
}

// No width/padding of its own — every page decides its own width via
// StorefrontPageShell (see that component), which is what lets a hero
// section render truly edge to edge while an account/checkout page still
// gets a sensibly capped, centered column. Previously a single blanket
// max-w-6xl wrapper here capped literally everything, including hero
// banners that should bleed to the viewport edge, while giving narrow forms
// no positioning of their own beyond hugging that box's left edge.
//
// previewMode bypasses the unpublished-shop gate below — a merchant setting
// up their first theme, before ever publishing, still needs to see it in
// the builder's live preview iframe (see PreviewFrame.tsx/shop-context.tsx).
// Every content endpoint this page's real children would call is still
// independently published-gated server-side (PublicService.assertPublished)
// regardless of what renders here, so this is purely a friendlier preview
// experience, not a new way to leak an unpublished shop's content.
function Body({ children }: { children: React.ReactNode }) {
  const { shop, loading, previewMode, themeConfig } = useShop();
  // C2 — reserve space for the fixed bottom-bar mobile nav so it never
  // overlaps the last bit of page content/footer.
  const bottomBarSpacingClass = themeConfig?.header.settings.mobileNav === "bottom-bar" ? "pb-14 md:pb-0" : "";

  // While the shop itself is still resolving, render ONLY the neutral
  // skeleton — never the branded chrome (TopBar/MenuBar), which at this
  // point has no shop/theme and would flash the raw slug text plus default
  // Requital iconography before the merchant's real theme loads.
  if (loading) {
    return <StorefrontLoadingSkeleton />;
  }

  if (!loading && shop && !shop.published && !previewMode) {
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
      <main className={`flex-1 ${bottomBarSpacingClass}`}>{children}</main>
      <Footer />
      <WhatsAppFloatingButton />
      <FloatingCustomButtons />
      <CookieConsentBanner />
      {previewMode && (
        <>
          <PreviewImageDragGuard />
          <PreviewInteraction />
        </>
      )}
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
        <WishlistProvider shopSlug={shopSlug}>
          <CartProvider shopSlug={shopSlug}>
            {/* Always mounted, regardless of theme.cartLayout — TopBar's cart
                icon calls useCartDrawer() unconditionally (see components/
                TopBar.tsx) so the context must exist even for shops using the
                full-page cart, where it's simply never opened. */}
            <CartDrawerProvider>
              <Body>{children}</Body>
            </CartDrawerProvider>
          </CartProvider>
        </WishlistProvider>
      </AuthProvider>
    </ShopProvider>
  );
}
