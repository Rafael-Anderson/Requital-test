"use client";

import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { bioLinkClickUrl, getBioLinks, getBioPageConfig, resolveImageUrl } from "@/lib/api";
import { resolveBioPageDisplay } from "@/lib/bio-page";
import { SOCIAL_ICONS } from "@/lib/social-icons";
import type { BioLink, BioPageConfig } from "@/lib/types";
import StorefrontLoadingSkeleton from "@/components/StorefrontLoadingSkeleton";

const EMPTY_CONFIG: BioPageConfig = {
  logoUrl: null,
  backgroundUrl: null,
  description: null,
  metaTitle: null,
  metaDescription: null,
};

// Uses the shop's own Theme (bg-accent/text-accent-foreground/border-stroke
// etc, applied via ShopProvider — see lib/shop-context.tsx), not any
// admin-panel styling. Rendered inside the standard ShopLayoutClient
// wrapper (same Header/CollectionNav every storefront page gets), so it
// automatically inherits the "Coming soon" gating for an unpublished shop
// — see ShopLayoutClient's Body component — with no extra code needed here.
export default function BioPage() {
  const { shopSlug, shop, loading: shopLoading } = useShop();
  const [links, setLinks] = useState<BioLink[] | null>(null);
  const [bioPageConfig, setBioPageConfig] = useState<BioPageConfig | null>(null);

  useEffect(() => {
    if (shopLoading) return;
    getBioLinks(shopSlug)
      .then(setLinks)
      .catch(() => setLinks([]));
    getBioPageConfig(shopSlug)
      .then(setBioPageConfig)
      .catch(() => setBioPageConfig(EMPTY_CONFIG));
  }, [shopSlug, shopLoading]);

  if (shopLoading || links === null || bioPageConfig === null || !shop) {
    return <StorefrontLoadingSkeleton />;
  }

  const socialLinks = links.filter((l) => l.type === "SOCIAL_ICON");
  const otherLinks = links.filter((l) => l.type !== "SOCIAL_ICON");
  const display = resolveBioPageDisplay(shop, bioPageConfig);
  const logo = resolveImageUrl(display.logoUrl);
  const backgroundImage = resolveImageUrl(display.backgroundUrl);
  const displayName = shop.displayName ?? shop.name ?? shopSlug;

  return (
    <div
      className="rounded-2xl -mx-4 sm:mx-0"
      style={
        backgroundImage
          ? { backgroundImage: `url(${backgroundImage})`, backgroundSize: "cover", backgroundPosition: "center" }
          : undefined
      }
    >
      <div className="max-w-md mx-auto flex flex-col items-center py-6 px-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={displayName} className="size-20 rounded-full object-cover mb-3 border border-stroke" />
        ) : (
          <div className="size-20 rounded-full bg-accent/10 flex items-center justify-center mb-3">
            <span className="text-2xl font-semibold text-accent-text">{displayName.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <h1 className="text-lg font-semibold text-center">{displayName}</h1>
        {display.description && (
          <p className="text-sm text-zinc-500 text-center mt-1 max-w-xs">{display.description}</p>
        )}

        {socialLinks.length > 0 && (
          <div className="flex items-center gap-3 mt-4 flex-wrap justify-center">
            {socialLinks.map((link) => {
              const Icon = link.socialPlatform ? SOCIAL_ICONS[link.socialPlatform] : null;
              return (
                <a
                  key={link.id}
                  href={bioLinkClickUrl(link.id)}
                  title={link.label}
                  className="flex items-center justify-center size-10 rounded-full bg-accent/10 text-accent-text hover:bg-accent/20 transition-colors"
                >
                  {Icon && <Icon className="size-5" strokeWidth={1.75} />}
                </a>
              );
            })}
          </div>
        )}

        <div className="w-full flex flex-col gap-3 mt-5">
          {otherLinks.length === 0 && socialLinks.length === 0 && (
            <p className="text-sm text-zinc-400 text-center">No links yet.</p>
          )}
          {otherLinks.map((link) => {
            const thumbnail =
              link.type === "PRODUCT"
                ? link.product?.thumbnail
                : link.type === "COLLECTION"
                  ? link.collection?.image
                  : link.type === "TEMPLATE"
                    ? link.template?.image
                    : null;
            const resolvedThumbnail = resolveImageUrl(thumbnail);
            return (
              <a
                key={link.id}
                href={bioLinkClickUrl(link.id)}
                className="flex items-center gap-3 w-full rounded-xl border border-stroke bg-white dark:bg-zinc-900 px-4 py-3 text-sm font-medium hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
              >
                {resolvedThumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolvedThumbnail} alt="" className="size-9 rounded-lg object-cover shrink-0" />
                )}
                <span className="flex-1 text-center">{link.label}</span>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
