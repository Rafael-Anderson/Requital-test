import type { BioPageConfig, Shop } from "./types";

export interface BioPageDisplay {
  logoUrl: string | null;
  backgroundUrl: string | null;
  description: string | null;
}

// Pure (no fetch/DOM) so the fallback chain — bio-specific override wins,
// otherwise inherit Theme's own logo/banner — is directly testable without
// rendering the page. shop.logoUrl/shop.bannerUrl are themselves already
// Theme-resolved by the backend (see PublicService.getShop), so this never
// needs to know about Theme directly. `description` has no fallback — only
// logo/background inherit from Theme; an unset bio description just renders
// nothing, matching what the task actually asked for (only logo/background/
// meta were specified as falling back).
export function resolveBioPageDisplay(shop: Pick<Shop, "logoUrl" | "bannerUrl">, config: BioPageConfig): BioPageDisplay {
  return {
    logoUrl: config.logoUrl ?? shop.logoUrl,
    backgroundUrl: config.backgroundUrl ?? shop.bannerUrl,
    description: config.description,
  };
}
