"use client";

import type { CSSProperties, ReactNode } from "react";
import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";
import { isTrustedAdminOrigin } from "@/lib/theme-preview-origin";
import { resolveScheme } from "@/lib/theme-color-scheme";
import type { SectionSettings } from "@/lib/theme-config-types";

// Bug 9 fix: Header/Footer (ThemeDrivenHeader.tsx/ThemeDrivenFooter.tsx)
// used to have their own bespoke, solid-only copy of this logic - a
// "gradient" or "image" background type (both real, selectable options in
// the same admin BackgroundControls used for every section) silently did
// nothing for Header/Footer specifically, leaving them fully transparent.
// Combined with the header's own `sticky` option, that meant whatever
// scrolled underneath (most commonly the Hero section directly below,
// itself often carrying a real background image) showed straight through
// the header, which is what actually produced the reported "header text
// overlapping a background image" symptom - not a z-index/spacing bug, a
// missing two-thirds of this function's own cases. Exported so both of
// those components reuse the exact same resolution every other section's
// background already goes through, instead of drifting out of sync again.
export function backgroundStyle(bg: SectionSettings["background"]): CSSProperties {
  if (!bg || typeof bg !== "object") return {};
  const type = bg.type as string | undefined;
  if (type === "solid" && typeof bg.color === "string") {
    return { background: bg.color };
  }
  if (type === "gradient" && typeof bg.gradientFrom === "string" && typeof bg.gradientTo === "string") {
    return { background: `linear-gradient(135deg, ${bg.gradientFrom}, ${bg.gradientTo})` };
  }
  if (type === "image" && typeof bg.imageUrl === "string") {
    // bg.imageUrl is a backend-relative upload path (e.g. /uploads/theme/...)
    // — used raw here, this 404s: the storefront and backend are different
    // origins, so a bare url(/uploads/...) resolves against the storefront's
    // own origin, which never served that file. Every other image reference
    // in this app already goes through resolveImageUrl for exactly this
    // reason (see ImageTextSection.tsx); this was the one place that didn't.
    const resolved = resolveImageUrl(bg.imageUrl);
    if (!resolved) return {};
    return { backgroundImage: `url(${resolved})`, backgroundSize: "cover", backgroundPosition: "center" };
  }
  return {};
}

// Applies every section's shared settings (padding, background, visibility)
// — the one place SectionRenderer routes every section type through, so a
// new section type gets these for free rather than reimplementing them.
// Scroll animation is applied by ScrollAnimatedWrapper (Phase 5), which
// wraps this component rather than being folded into it.
//
// Reverse preview channel (preview mode only): clicking a section posts
// {type: 'theme-section-selected', sectionId} to window.parent so the
// admin editor's left panel can sync its selection to whatever the
// merchant clicks inside the live preview. Uses document.referrer (the
// page that loaded this iframe) as the postMessage target origin, checked
// against the same trusted-origin allowlist the incoming listener uses —
// never '*'.
export default function SectionWrapper({
  sectionId,
  settings,
  children,
}: {
  sectionId: string;
  settings: SectionSettings;
  children: ReactNode;
}) {
  const { previewMode, themeConfig } = useShop();
  const spacing = settings.spacing ?? {};
  const visibility = settings.visibility ?? "both";
  const visibilityClass =
    visibility === "desktop" ? "hidden md:block" : visibility === "mobile" ? "block md:hidden" : "";
  const scheme = resolveScheme(settings.schemeId, themeConfig?.globalSettings.colorSchemes ?? []);
  const schemeStyle: CSSProperties = scheme ? { background: scheme.background, color: scheme.text } : {};

  function handleClick() {
    if (!previewMode || !document.referrer) return;
    const referrerOrigin = new URL(document.referrer).origin;
    if (!isTrustedAdminOrigin(referrerOrigin)) return;
    window.parent.postMessage({ type: "theme-section-selected", sectionId }, referrerOrigin);
  }

  return (
    <section
      className={`${visibilityClass} ${previewMode ? "cursor-pointer" : ""}`}
      onClick={previewMode ? handleClick : undefined}
      style={{
        paddingTop: spacing.top !== undefined ? `${spacing.top}px` : undefined,
        paddingBottom: spacing.bottom !== undefined ? `${spacing.bottom}px` : undefined,
        paddingLeft: spacing.left !== undefined ? `${spacing.left}px` : undefined,
        paddingRight: spacing.right !== undefined ? `${spacing.right}px` : undefined,
        ...schemeStyle,
        ...backgroundStyle(settings.background),
      }}
    >
      {children}
    </section>
  );
}
