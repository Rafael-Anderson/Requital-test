"use client";

import type { CSSProperties, ReactNode } from "react";
import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";
import { isTrustedAdminOrigin } from "@/lib/theme-preview-origin";
import { resolveScheme } from "@/lib/theme-color-scheme";
import type { SectionSettings } from "@/lib/theme-config-types";

function backgroundStyle(bg: SectionSettings["background"]): CSSProperties {
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
