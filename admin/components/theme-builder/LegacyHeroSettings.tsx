"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import BannerImageGallery from "@/components/BannerImageGallery";
import { useLegacyTheme } from "@/lib/useLegacyTheme";
import type { BannerImage } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// The old Theme Customizer's "Homepage Content" card (Hero/Banner Text +
// slideshow images, app/theme/edit/site-settings/page.tsx) — used by the
// classic storefront's Classic/Slideshow homepage layouts, independent of
// this section's own heading/subheading/cta blocks above (which only
// render for a published new-system theme).
//
// This only ever has an effect when BOTH are true: (1) the shop has no
// published new-system theme (storefront/app/[shop]/page.tsx falls through
// to the legacy dispatch only when themeConfig is null — see
// backend/src/public/public.service.ts's getThemeConfig), and (2) Layout
// mode's Homepage layout is set to Classic or Slideshow specifically (the
// only two HomepageTop branches that read bannerUrl/heroText/banners at
// all — Featured Grid and Grid First never touch them). Previously this
// subsection was always shown, fully editable, with only a passive caption
// noting the relationship — a merchant could upload banner images here that
// silently did nothing. Gated the same way LayoutSettings.tsx's own 13
// categories already gate on published-theme dead-ness
// (DeadOnceSectionsPublished), extended with the second, narrower
// layout-specific check this field also needs.
export default function LegacyHeroSettings({ editor }: { editor: ThemeEditorState }) {
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

  function jumpToHomepageLayout() {
    editor.setEditorMode("layout");
    editor.setLayoutCategory("Homepage layout");
  }

  const sectionsPublished = editor.theme?.isPublished ?? false;
  const currentLayout = editor.legacyTheme?.homepageLayout;
  const layoutUsesBanner = currentLayout === "classic" || currentLayout === "slideshow";

  if (sectionsPublished) {
    return (
      <details className="rounded-lg border border-black/10 dark:border-white/10">
        <summary className="cursor-pointer p-3 text-sm font-medium">Classic homepage banner</summary>
        <div className="border-t border-black/10 p-3 text-xs text-zinc-500 dark:border-white/10">
          Your storefront uses the Sections builder, so this legacy setting has no effect. Edit the Hero block
          above instead, or manage sections in the Sections tab.
        </div>
      </details>
    );
  }

  if (!layoutUsesBanner) {
    return (
      <details className="rounded-lg border border-black/10 dark:border-white/10">
        <summary className="cursor-pointer p-3 text-sm font-medium">Classic homepage banner</summary>
        <div className="border-t border-black/10 p-3 text-xs text-zinc-500 dark:border-white/10">
          This shop&apos;s homepage layout doesn&apos;t use this setting.{" "}
          <button type="button" onClick={jumpToHomepageLayout} className="text-accent-text underline dark:text-accent">
            Change it in Layout mode &rarr; Homepage layout.
          </button>
        </div>
      </details>
    );
  }

  return (
    <details className="rounded-lg border border-black/10 dark:border-white/10">
      <summary className="cursor-pointer p-3 text-sm font-medium">Classic homepage banner</summary>
      <div className="space-y-4 border-t border-black/10 p-3 dark:border-white/10">
        <p className="text-xs text-zinc-500">
          This controls the banner shown by your Classic/Slideshow homepage layout, separate from the Hero block
          settings above.
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
