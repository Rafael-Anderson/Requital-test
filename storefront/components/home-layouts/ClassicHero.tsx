"use client";

import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";
import { storeButtonClassName } from "@/lib/button-style";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// The storefront's original (only) homepage top section, before the
// Advanced tab's layout picker existed — kept as-is under the "classic"
// name, the default for every shop that never touches Advanced. Renders
// full-bleed (edge to edge) — the caller (app/[shop]/page.tsx) places this
// outside the page's own StorefrontPageShell width cap for exactly that
// reason, matching a real storefront's hero treatment rather than a boxed
// card floating inside the content column.
//
// Previously rendered nothing at all when the merchant hadn't uploaded a
// banner or set hero text (see the storefront design audit — this is the
// out-of-box state for most shops, since Theme's banner upload is an opt-in
// extra step). That meant most storefronts went straight from the header
// into the product grid with zero brand moment. This now falls back to a
// hero built entirely from data every shop already has — its own name and
// its own accent color (color-mix against the existing --color-accent
// variable) — instead of a blank void. A merchant who HAS set a banner/
// heroText still sees exactly that, byte for byte unchanged; this only
// fills in the previously-empty branch. brandBackgroundColor (Appearance
// Color) overrides the computed accent tint when a merchant explicitly sets
// it; left unset (the common case), the tint stays exactly as before.
export default function ClassicHero({ bannerUrl, heroText }: { bannerUrl: string | null; heroText: string | null }) {
  const { shop, shopBasePath } = useShop();

  if (!bannerUrl && !heroText) {
    if (!shop) return null;
    const brandBg = shop.colors?.brandBackgroundColor;
    const background =
      brandBg && HEX_COLOR.test(brandBg) ? brandBg : "color-mix(in srgb, var(--color-accent) 8%, var(--background))";
    return (
      <div className="px-6 py-16 sm:py-24 text-center" style={{ background }}>
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight text-balance">
          {shop.displayName ?? shop.name}
        </h1>
        <p className="mt-4 text-sm sm:text-base text-zinc-500 max-w-md mx-auto">
          {shop.description || "Thoughtfully curated, delivered to your door."}
        </p>
        <Link
          href={`${shopBasePath || "/"}#shop`}
          className={`inline-flex items-center justify-center h-11 px-6 mt-8 font-medium ${storeButtonClassName(shop)}`}
        >
          Shop now
        </Link>
      </div>
    );
  }

  return (
    <div>
      {bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolveImageUrl(bannerUrl) ?? undefined} alt="" className="w-full h-48 sm:h-72 object-cover" />
      )}
      {heroText && <p className="px-4 py-3 text-sm text-center text-zinc-600 bg-homepage-info">{heroText}</p>}
    </div>
  );
}
