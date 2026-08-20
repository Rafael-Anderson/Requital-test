"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ShoppingCart, User } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useCartDrawer } from "@/lib/cart-drawer";
import { resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveImageElementStyle, resolveIconElementStyle, resolveIconStrokeWidth } from "@/lib/theme-element-style";
import { iconStyleProps } from "@/lib/icon-style";
import SearchBar from "@/components/SearchBar";
import ThemeImageBlock from "./ThemeImageBlock";
import { backgroundStyle } from "./SectionWrapper";
import type { Customer, Shop } from "@/lib/types";
import type { HeaderFooterConfig, SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

const ZONES = ["left", "center", "right"] as const;

// Bug 5 fix: header_text's font size is now a real numeric px value (see
// admin's HeaderTextElementSettings) - this legacy 3-step table is kept
// only as a fallback for a block saved before that change, whose
// settings.fontSize is still one of these strings rather than a number.
const HEADER_TEXT_LEGACY_FONT_SIZE: Record<string, string> = {
  small: "13px",
  medium: "15px",
  large: "18px",
};

const HEADER_TEXT_FONT_FAMILY: Record<string, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  monospace: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
};

// Bug 5's "position relative to logo" control — a targeted tiebreak on top
// of normal block order (the tree's own drag-reorder, per zone) rather than
// a second, competing ordering concept: only nudges a header_text block
// that both shares a zone with the logo AND has explicitly set this field,
// placing it immediately before/after wherever the logo already sits.
// Every other block's order is untouched.
function applyLogoRelativePosition(zoneBlocks: ThemeBlock[]): ThemeBlock[] {
  if (!zoneBlocks.some((b) => b.type === "logo")) return zoneBlocks;
  let result = zoneBlocks;
  for (const block of zoneBlocks) {
    if (block.type !== "header_text") continue;
    const pos = block.settings.positionRelativeToLogo as string | undefined;
    if (pos !== "before" && pos !== "after") continue;
    const without = result.filter((b) => b.id !== block.id);
    const logoIndex = without.findIndex((b) => b.type === "logo");
    if (logoIndex === -1) continue;
    const insertAt = pos === "before" ? logoIndex : logoIndex + 1;
    result = [...without.slice(0, insertAt), block, ...without.slice(insertAt)];
  }
  return result;
}

// Matches admin/lib/useThemeEditor.ts's HEADER_CHROME_ID by hand — same
// no-shared-package convention as every other cross-app constant. Only
// used as the data-requital-section grouping key for the in-preview
// selection/drag feature (PreviewInteraction.tsx); PreviewFrame.tsx's
// element-moved handler checks for this exact string.
const HEADER_CHROME_ID = "__header__";

// Global chrome — pinned to every page, not part of the reorderable
// sections list (see the plan's scope decision). Each block's own
// settings.zone (left/center/right, defaulting to left) places it in the
// 3-column header row. nav_menu has no zone rendering of its own here — the
// existing MenuBar row (ShopLayoutClient.tsx's Header()) already renders
// full-width below this component for both themed and legacy shops; that
// component reads this same config to decide whether to show it, so the
// block's visibility is still honored, just not by this file.
// `transparentOnHero` is collected in the admin settings panel but not yet
// visually wired here — flagged, not silently dropped.
export default function ThemeDrivenHeader({
  shopSlug,
  shop,
  customer,
  count,
  config,
}: {
  shopSlug: string;
  shop: Shop | null;
  customer: Customer | null;
  count: number;
  config: HeaderFooterConfig;
}) {
  const { shopBasePath, previewMode, themeConfig } = useShop();
  const { openDrawer } = useCartDrawer();
  const sticky = !!config.settings.sticky;

  // Bug 9 fix: was solid-only (see backgroundStyle's own comment) - now
  // resolves gradient/image the same as every section does.
  const style: CSSProperties = backgroundStyle(config.settings.background as SectionSettings["background"]);

  const blocks = [...config.blocks].filter((b) => b.visible).sort((a, b) => a.order - b.order);
  // Two independent, already-real settings layered together: shop.iconStyle
  // (legacy Layout mode's "Icon style" — solid vs outline, via fill) picks
  // WHICH rendering; globalSettings.icons.stroke (Theme Settings' newer
  // category) picks the outline variant's stroke width, replacing what used
  // to be a hardcoded 1.75 default. iconStyleProps ignores the width for
  // "solid" (near-zero stroke, filled shape), so this only visibly changes
  // anything for shops on the outline style — correct, since a heavier
  // "stroke" has no meaning on a filled icon.
  const iconStrokeWidth = resolveIconStrokeWidth(themeConfig?.globalSettings.icons.stroke);
  const iconProps = iconStyleProps(shop?.iconStyle, iconStrokeWidth);
  // New-system Theme Settings > Logo wins over the legacy shop.logoUrl
  // field (set via Business Information/the old Customizer) when a
  // merchant has actually uploaded one there — the legacy field stays the
  // fallback for every shop that's never touched the new Logo category,
  // same "new system takes precedence, legacy is the fallback" convention
  // this app already uses for homepageLayout/colors/etc.
  const logoUrl = resolveImageUrl(themeConfig?.globalSettings.logo.defaultLogoUrl ?? shop?.logoUrl ?? null);

  const cartButtonClass =
    "relative flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors";

  function renderBlock(block: ThemeBlock): ReactNode {
    switch (block.type) {
      case "logo":
        return (
          <Link
            key="logo"
            href={shopBasePath || "/"}
            {...editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "logo" })}
            className="flex items-center gap-2 min-w-0"
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={shop?.displayName ?? shop?.name}
                className="theme-logo-img max-w-40 object-contain shrink-0"
                style={resolveImageElementStyle(block.settings)}
              />
            ) : (
              <span className="font-semibold text-lg truncate">
                {shop?.displayName ?? shop?.name ?? shopSlug}
              </span>
            )}
          </Link>
        );
      case "search_icon":
        return (
          <span
            key="search"
            {...editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "search_icon" })}
          >
            <SearchBar iconStrokeWidth={iconStrokeWidth} iconOverrideStyle={resolveIconElementStyle(block.settings)} />
          </span>
        );
      case "cart_icon": {
        if (shop?.disableStoreCart) return null;
        const cartContent = (
          <>
            <ShoppingCart className="size-5" {...iconProps} style={resolveIconElementStyle(block.settings)} />
            {count > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-medium">
                {count}
              </span>
            )}
          </>
        );
        const tagProps = editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "cart_icon" });
        return shop?.cartLayout === "drawer" ? (
          <button key="cart" type="button" onClick={openDrawer} aria-label="Open cart" {...tagProps} className={`${cartButtonClass} cursor-pointer`}>
            {cartContent}
          </button>
        ) : (
          <Link key="cart" href={`${shopBasePath}/cart`} {...tagProps} className={cartButtonClass}>
            {cartContent}
          </Link>
        );
      }
      case "account_icon":
        return (
          <Link
            key="account"
            href={customer ? `${shopBasePath}/account` : `${shopBasePath}/account/login`}
            title={customer ? `Signed in as ${customer.name}` : "Sign in"}
            {...editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "account_icon" })}
            className="flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors"
          >
            <User className="size-5" {...iconProps} style={resolveIconElementStyle(block.settings)} />
          </Link>
        );
      case "image":
        return <ThemeImageBlock key={block.id} block={block} sectionId={HEADER_CHROME_ID} previewMode={previewMode} />;
      // Bug 5 fix: zone is now a real admin-editable control
      // (HeaderTextElementSettings' "Alignment" select) — an unset
      // settings.zone still falls into "left" via the filter below, so an
      // existing block from before that change keeps its current position.
      case "header_text": {
        const text = block.settings.text as string | undefined;
        if (!text) return null;
        const fontSizeSetting = block.settings.fontSize;
        const fontSize =
          typeof fontSizeSetting === "number"
            ? `${fontSizeSetting}px`
            : (HEADER_TEXT_LEGACY_FONT_SIZE[fontSizeSetting as string] ?? HEADER_TEXT_LEGACY_FONT_SIZE.medium);
        const fontFamily = HEADER_TEXT_FONT_FAMILY[block.settings.fontFamily as string];
        return (
          <span
            key={block.id}
            {...editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "header_text" })}
            style={{
              fontSize,
              fontWeight: (block.settings.fontWeight as string) ?? "400",
              ...(fontFamily ? { fontFamily } : {}),
              color: (block.settings.color as string) ?? "#1B1F1E",
            }}
            className="truncate"
          >
            {text}
          </span>
        );
      }
      default:
        return null;
    }
  }

  return (
    <div className={`${sticky ? "sticky top-0 z-30" : ""} border-b border-stroke`} style={style}>
      <div className="mx-auto px-4 py-3 grid grid-cols-3 items-center gap-4" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
        {ZONES.map((zone) => (
          <div
            key={zone}
            className={`flex items-center gap-1 ${zone === "left" ? "justify-start" : zone === "center" ? "justify-center" : "justify-end"}`}
          >
            {applyLogoRelativePosition(
              blocks.filter((b) => (b.settings.zone as string | undefined) === zone || (zone === "left" && !b.settings.zone)),
            ).map((b) => renderBlock(b))}
          </div>
        ))}
      </div>
    </div>
  );
}
