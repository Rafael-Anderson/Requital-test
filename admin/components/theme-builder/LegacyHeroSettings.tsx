"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import BannerImageGallery from "@/components/BannerImageGallery";
import { useLegacyTheme } from "@/lib/useLegacyTheme";
import type { BannerImage } from "@/lib/types";

// The old Theme Customizer's "Homepage Content" card (Hero/Banner Text +
// slideshow images, app/theme/edit/site-settings/page.tsx) — used by the
// classic storefront's Classic/Slideshow homepage layouts, independent of
// this section's own heading/subheading/cta blocks above (which only
// render for a published new-system theme).
export default function LegacyHeroSettings() {
  const { theme, saving, save } = useLegacyTheme();
  const [heroText, setHeroText] = useState("");
  const [bannerImages, setBannerImages] = useState<BannerImage[]>([]);

  useEffect(() => {
    if (!theme) return;
    setHeroText(theme.heroText ?? "");
    setBannerImages(theme.images ?? []);
  }, [theme]);

  if (!theme) return null;

  async function handleSave() {
    await save({
      heroText: heroText.trim() || undefined,
      images: bannerImages.map(({ url, linkUrl, order }) => ({ url, linkUrl: linkUrl || undefined, order })),
    });
  }

  return (
    <details className="rounded-lg border border-black/10 dark:border-white/10">
      <summary className="cursor-pointer p-3 text-sm font-medium">Classic homepage banner</summary>
      <div className="space-y-4 border-t border-black/10 p-3 dark:border-white/10">
        <p className="text-xs text-zinc-500">
          Used by the classic storefront look&apos;s Classic and Slideshow homepage layouts (Layout mode), independent
          of this section&apos;s own blocks above.
        </p>
        <Input label="Hero / banner text" value={heroText} onChange={(e) => setHeroText(e.target.value)} placeholder="Fresh flowers, delivered same-day" />
        <BannerImageGallery images={bannerImages} onChange={setBannerImages} />
        <div className="flex justify-end">
          <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave()}>
            Save
          </Button>
        </div>
      </div>
    </details>
  );
}
