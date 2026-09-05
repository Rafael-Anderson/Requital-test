"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Globe, MessageCircle, Phone } from "lucide-react";
import { ShoppingCart, User } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useCartDrawer } from "@/lib/cart-drawer";
import { resolveImageUrl } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveImageElementStyle, resolveIconElementStyle, resolveIconStrokeWidth, resolveIconCorners } from "@/lib/theme-element-style";
import { resolveHeaderRows } from "@/lib/header-rows";
import { useHeaderScrollState } from "@/lib/use-header-scroll-state";
import { iconStyleProps } from "@/lib/icon-style";
import SearchBar from "@/components/SearchBar";
import MenuBar from "@/components/MenuBar";
import ThemeImageBlock from "./ThemeImageBlock";
import { backgroundStyle } from "./SectionWrapper";
import type { Customer, Shop } from "@/lib/types";
import type { HeaderFooterConfig, HeaderScrollBehavior, SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

const ROW_JUSTIFY: Record<string, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
  between: "justify-between",
};

const SOCIAL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "Twitter",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  linkedin: "LinkedIn",
};

const ZONES = ["left", "center", "right"] as const;

// C1 — header.settings.height. Each render path keeps its own current
// padding as the 'default'/absent case (the rows path and the classic
// 3-zone grid never shared the same py-* to begin with), so an untouched
// shop's padding is byte-identical either way.
const HEADER_ROWS_PY: Record<string, string> = { compact: "py-1", default: "py-2", tall: "py-4" };
const HEADER_CLASSIC_PY: Record<string, string> = { compact: "py-2", default: "py-3", tall: "py-5" };

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
// `transparentOnHero` (§8.7 item 2) is wired in ShopLayoutClient.tsx's
// ancestor <header>, not here — that element owns the header's real opaque
// background, so the transparent-over-hero state has to toggle there.
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
  // §8.7 item 2 — precedence: scrollBehavior (when present) is the sole
  // source of truth; the legacy bare `sticky` boolean is only consulted
  // when scrollBehavior is absent (back-compat, byte-identical for a shop
  // that's never touched the new field). 'shrink'/'hide-on-scroll'/
  // 'reveal-on-hero' promote the WHOLE header to sticky one level up
  // (ShopLayoutClient.tsx) — this div does not also apply its own sticky
  // for those three, avoiding a redundant nested-sticky pair; only the
  // plain 'sticky' value (or the legacy boolean) applies it narrowly here,
  // exactly as before.
  const scrollBehavior = (config.settings.scrollBehavior as HeaderScrollBehavior) || "";
  const sticky = scrollBehavior ? scrollBehavior === "sticky" : !!config.settings.sticky;
  const transparentOnHero = !!config.settings.transparentOnHero;
  const { shrunk } = useHeaderScrollState(scrollBehavior, transparentOnHero);
  const heightKey = shrunk ? "compact" : (config.settings.height as string) || "default";
  // Only added for 'shrink' — a shop on any other value never gets a
  // transition-padding class it doesn't need.
  const shrinkTransitionClass = scrollBehavior === "shrink" ? "theme-header-shrink-transition" : "";
  // C1 — header.settings.contentWidth: 'full' drops the max-width cap
  // entirely; absent/'contained' (default) keeps today's var() cap.
  const contentMaxWidth = config.settings.contentWidth === "full" ? undefined : "var(--theme-max-width, 80rem)";
  const contentStyle: CSSProperties | undefined = contentMaxWidth ? { maxWidth: contentMaxWidth } : undefined;

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
  // §8.7 item 4 — icons.corners rides the same iconProps spread as
  // stroke width; unset ⇒ lucide's own round/round default, explicitly.
  const iconCorners = resolveIconCorners(themeConfig?.globalSettings.icons.corners);
  const iconProps = { ...iconStyleProps(shop?.iconStyle, iconStrokeWidth), ...iconCorners };
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
                // §8.7 item 2 — 'shrink' scales the logo down via a toggled
                // class (transform, compositor-only, no reflow) rather than
                // touching the --theme-logo-height var mechanism.
                className={`theme-logo-img max-w-40 object-contain shrink-0 ${shrunk ? "theme-logo-shrink" : ""}`}
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
            <SearchBar
              iconStrokeWidth={iconStrokeWidth}
              iconCorners={iconCorners}
              iconOverrideStyle={resolveIconElementStyle(block.settings)}
              showLabel={block.settings.showLabel === true}
            />
          </span>
        );
      case "cart_icon": {
        if (shop?.disableStoreCart) return null;
        const cartShowLabel = block.settings.showLabel === true;
        const cartClass = cartShowLabel
          ? "relative flex items-center gap-1.5 h-9 px-3 rounded-full hover:bg-mouse-over/10 transition-colors"
          : cartButtonClass;
        const cartContent = (
          <>
            <ShoppingCart className="size-5" {...iconProps} style={resolveIconElementStyle(block.settings)} />
            {cartShowLabel && <span className="text-sm">Cart</span>}
            {count > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-medium">
                {count}
              </span>
            )}
          </>
        );
        const tagProps = editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "cart_icon" });
        return shop?.cartLayout === "drawer" ? (
          <button key="cart" type="button" onClick={openDrawer} aria-label="Open cart" {...tagProps} className={`${cartClass} cursor-pointer`}>
            {cartContent}
          </button>
        ) : (
          <Link key="cart" href={`${shopBasePath}/cart`} {...tagProps} className={cartClass}>
            {cartContent}
          </Link>
        );
      }
      case "account_icon": {
        const accountShowLabel = block.settings.showLabel === true;
        return (
          <Link
            key="account"
            href={customer ? `${shopBasePath}/account` : `${shopBasePath}/account/login`}
            title={customer ? `Signed in as ${customer.name}` : "Sign in"}
            {...editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "account_icon" })}
            className={
              accountShowLabel
                ? "flex items-center gap-1.5 h-9 px-3 rounded-full hover:bg-mouse-over/10 transition-colors"
                : "flex items-center justify-center size-9 rounded-full hover:bg-mouse-over/10 transition-colors"
            }
          >
            <User className="size-5" {...iconProps} style={resolveIconElementStyle(block.settings)} />
            {accountShowLabel && <span className="text-sm">Account</span>}
          </Link>
        );
      }
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
      // theme-builder-expansion Phase 3 — header utility blocks. Render in
      // both the rows path and (for robustness) the classic zone path if a
      // merchant adds one without configuring rows.
      case "nav_menu":
        return <MenuBar key={block.id} inline />;
      case "contact_bar_item": {
        const kind = (block.settings.kind as string) ?? "text";
        const value = (block.settings.value as string) ?? "";
        const label = (block.settings.label as string) || value;
        if (!value) return null;
        const cls = "inline-flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity";
        const tagProps = editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "contact_bar_item" });
        if (kind === "phone") {
          return (
            <a key={block.id} href={`tel:${value.replace(/[^\d+]/g, "")}`} className={cls} {...tagProps}>
              <Phone className="size-4 shrink-0" {...iconProps} />
              {label}
            </a>
          );
        }
        if (kind === "whatsapp") {
          return (
            <a
              key={block.id}
              href={`https://wa.me/${value.replace(/[^\d]/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cls}
              {...tagProps}
            >
              <MessageCircle className="size-4 shrink-0" {...iconProps} />
              {label}
            </a>
          );
        }
        return (
          <span key={block.id} className="inline-flex items-center gap-1.5 text-sm" {...tagProps}>
            {label}
          </span>
        );
      }
      case "social_row": {
        const links = Array.isArray(block.settings.links) ? (block.settings.links as { platform?: string; url?: string }[]) : [];
        const valid = links.filter((l) => l && typeof l.url === "string" && l.url);
        if (valid.length === 0) return null;
        return (
          <span
            key={block.id}
            className="inline-flex items-center gap-2.5"
            {...editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "social_row" })}
          >
            {valid.map((l, i) => (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={SOCIAL_LABEL[(l.platform ?? "").toLowerCase()] ?? l.platform ?? "Social link"}
                className="text-sm hover:opacity-70 transition-opacity"
              >
                {SOCIAL_LABEL[(l.platform ?? "").toLowerCase()] ?? l.platform ?? "Link"}
              </a>
            ))}
          </span>
        );
      }
      // Non-functional placeholder (decision TBE4) — renders the affordance
      // so a merchant's header layout looks complete; wired up when
      // multi-language support ships. No click behaviour.
      case "language_switcher":
        return (
          <span
            key={block.id}
            className="inline-flex items-center gap-1 text-sm opacity-70 select-none"
            {...editableAttrs(previewMode, { id: block.id, sectionId: HEADER_CHROME_ID, type: "language_switcher" })}
          >
            <Globe className="size-4 shrink-0" {...iconProps} />
            EN
            <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
          </span>
        );
      default:
        return null;
    }
  }

  // No hairline between this (the logo/icons row) and the nav row directly
  // below it — they're one visual header unit, and a hardcoded light
  // border-stroke only ever read as a stray white seam (especially on a
  // dark custom header). Header/page separation is the outer <header>'s job
  // (ShopLayoutClient), which is theme-colour-aware.
  const outerClass = sticky ? "sticky top-0 z-30" : "";

  // theme-builder-expansion Phase 3 (TBE1). `resolveHeaderRows` returns null
  // whenever header.settings.rows is absent/empty/invalid — in which case
  // the classic single 3-zone grid below renders BYTE-FOR-BYTE unchanged
  // (regression-tested). Only a merchant who has explicitly built rows takes
  // the multi-row branch.
  const rows = resolveHeaderRows(config.settings, blocks);
  if (rows) {
    return (
      <div className={outerClass} style={style}>
        {rows.map((row, i) => (
          <div
            key={row.id}
            className={`${i > 0 ? "border-t border-stroke/60" : ""}`}
            style={row.background ? { background: row.background } : undefined}
          >
            <div
              className={`mx-auto px-4 ${HEADER_ROWS_PY[heightKey] ?? HEADER_ROWS_PY.default} flex items-center gap-3 flex-wrap ${ROW_JUSTIFY[row.align] ?? "justify-start"} ${shrinkTransitionClass}`}
              style={contentStyle}
            >
              {applyLogoRelativePosition(row.blocks).map((b) => renderBlock(b))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={outerClass} style={style}>
      <div
        className={`mx-auto px-4 ${HEADER_CLASSIC_PY[heightKey] ?? HEADER_CLASSIC_PY.default} grid grid-cols-3 items-center gap-4 ${shrinkTransitionClass}`}
        style={contentStyle}
      >
        {ZONES.map((zone) => (
          <div
            key={zone}
            className={`flex items-center gap-1 ${zone === "left" ? "justify-start" : zone === "center" ? "justify-center" : "justify-end"}`}
          >
            {applyLogoRelativePosition(
              blocks.filter(
                (b) =>
                  // nav_menu never renders in the zone grid — the classic
                  // path leaves it to the separate below-header MenuBar
                  // (ShopLayoutClient). It only renders inside ThemeDrivenHeader
                  // when explicitly placed in a header row (Phase 3).
                  b.type !== "nav_menu" &&
                  ((b.settings.zone as string | undefined) === zone || (zone === "left" && !b.settings.zone)),
              ),
            ).map((b) => renderBlock(b))}
          </div>
        ))}
      </div>
    </div>
  );
}
