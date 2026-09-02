"use client";

import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";

// Full-viewport placeholder shown while the shop itself (ShopProvider's own
// getShop()/listOutlets() fetch, see lib/shop-context.tsx) is still
// resolving — not a per-widget spinner for a page's own secondary fetch.
// Deliberately no chrome (Header/Footer aren't mounted yet at this point on
// every page that uses it).
//
// Theme-aware: reads --background / --color-header-fg rather than hardcoded
// white + gray-200, so a dark-branded shop doesn't flash a white screen.
// app/[shop]/layout.tsx sets those vars server-side, so they're already
// correct on the very first paint (before ShopProvider's client fetch runs).
// Shows the shop logo once it's known — on a cold load `shop` is still null
// so it falls back to a plain pulse block.
export default function StorefrontLoadingSkeleton() {
  const { shop } = useShop();
  const logo = resolveImageUrl(shop?.logoUrl ?? null);
  const blockStyle = { background: "color-mix(in srgb, var(--color-header-fg, #171717) 12%, transparent)" };

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center gap-6 p-6"
      style={{ background: "var(--background, #ffffff)", color: "var(--color-header-fg, #171717)" }}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-12 max-w-40 object-contain opacity-70 animate-pulse" />
      ) : (
        <div className="h-10 w-[200px] rounded-lg animate-pulse" style={blockStyle} />
      )}
      <div className="flex gap-4">
        <div className="h-[180px] w-40 rounded-lg animate-pulse" style={blockStyle} />
        <div className="h-[180px] w-40 rounded-lg animate-pulse" style={blockStyle} />
        <div className="h-[180px] w-40 rounded-lg animate-pulse" style={blockStyle} />
      </div>
    </div>
  );
}
