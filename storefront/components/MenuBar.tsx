"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useShop } from "@/lib/shop-context";
import { getMenu } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveNavElementStyle, resolveMenuBarBackground, FONT_WEIGHT_VALUE } from "@/lib/theme-element-style";
import type { MenuItem, MenuItemStyle } from "@/lib/types";
import CollectionNav from "@/components/CollectionNav";

// Matches admin/lib/useThemeEditor.ts's HEADER_CHROME_ID by hand — nav_menu
// is one of the header's own blocks (visibility only — see
// ThemeDrivenHeader.tsx's own comment on why this component, not that one,
// renders it), so its data-requital-section groups with the rest of the
// header for selection/drag purposes.
const HEADER_CHROME_ID = "__header__";

const RADIUS_PX: Record<NonNullable<MenuItemStyle["borderRadius"]>, string> = {
  none: "0px",
  slight: "6px",
  pill: "9999px",
};
// Optional per-item override (storefront-v2 Phase 1B) — undefined fields
// fall through to the nav's own default styling (theme-nav-link class).
// hoverBackgroundColor can't be expressed as a static inline style (no CSS
// :hover from JS), so it's applied via onMouseEnter/onMouseLeave swapping
// the resolved background in local state instead.
function useNavItemStyle(style: MenuItemStyle | null | undefined) {
  const [hovered, setHovered] = useState(false);
  const cssStyle: CSSProperties = {
    color: style?.textColor,
    background: hovered ? (style?.hoverBackgroundColor ?? style?.backgroundColor) : style?.backgroundColor,
    borderRadius: style?.borderRadius ? RADIUS_PX[style.borderRadius] : undefined,
    fontWeight: style?.fontWeight ? FONT_WEIGHT_VALUE[style.fontWeight] : undefined,
  };
  const handlers = style?.hoverBackgroundColor
    ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
    : {};
  return { cssStyle, handlers };
}

// storefront-v2 Phase 1D — the mega menu flyout for a MEGA item, sized to
// its own columns (not full-viewport-width). Still rendered via a portal to
// document.body, not a plain absolute descendant of the nav row: the nav
// row is `overflow-x-auto` for its horizontal item-scrolling behavior,
// which would clip a panel that opens below/beyond it (see the CSS
// overflow spec's "one axis auto forces the other to auto too" rule — a
// plain descendant here would get vertically clipped as well). Position is
// `fixed`, computed from the triggering item's own bounding rect (left)
// and the nav row's bottom (top) — `left` is clamped in the effect below
// so the panel never overflows the right edge of the viewport.
function MegaMenuPanel({
  item,
  top,
  left,
  animation,
  onMouseEnter,
  onMouseLeave,
}: {
  item: MenuItem;
  top: number;
  left: number;
  animation: "fade" | "slide" | "none";
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { shopBasePath } = useShop();
  const panelRef = useRef<HTMLDivElement>(null);
  const [adjustedLeft, setAdjustedLeft] = useState(left);

  // Right-boundary check: the panel's natural left (the trigger's own left
  // edge) can push a wide multi-column panel off the right side of the
  // viewport, especially near the end of the nav row or on a narrow
  // viewport. Runs before paint (useLayoutEffect) so there's no visible
  // jump from the unclamped to the clamped position.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const margin = 16;
    const width = el.getBoundingClientRect().width;
    const overflowRight = left + width + margin - window.innerWidth;
    setAdjustedLeft(overflowRight > 0 ? Math.max(margin, left - overflowRight) : left);
  }, [left, item.id]);

  const animationClass =
    animation === "none" ? "" : animation === "slide" ? "theme-mega-panel-slide" : "theme-mega-panel-fade";
  return createPortal(
    <div
      ref={panelRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ top, left: adjustedLeft, borderColor: "#E4E7E7", boxShadow: "0 8px 24px rgba(15,23,22,0.08)" }}
      className={`fixed z-40 w-fit max-w-[calc(100vw-2rem)] rounded-lg border bg-white ${animationClass} max-h-[70vh] overflow-y-auto`}
    >
      <div className="flex flex-wrap gap-8 px-6 py-6">
        {item.columns.map((column) => (
          <div key={column.id} className="w-48 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-2">{column.title}</p>
            <ul className="space-y-1.5">
              {column.links.map((link) => {
                const href =
                  link.linkType === "COLLECTION" && link.collection
                    ? `${shopBasePath}/collections/${link.collection.slug}`
                    : link.linkType === "PRODUCT" && link.product
                      ? `${shopBasePath}/products/${link.product.slug}`
                      : (link.customUrl ?? "#");
                return (
                  <li key={link.id}>
                    <Link
                      href={href}
                      className={`block text-sm transition-colors hover:underline ${
                        link.featured ? "text-accent-text font-medium" : "text-zinc-700"
                      }`}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// The storefront top bar's merchant-configured "Menu" (Phase C) — direct
// Collection links, Dropdowns (hover/focus panel listing several
// Collections), and Mega menus (storefront-v2 — named columns of links,
// a flyout sized to its own content). Falls back to the pre-existing CollectionNav pill
// list unchanged when the shop hasn't configured any menu items yet
// (backward-compatible default, matching every other opt-in theme feature's
// convention in this app — no merchant is forced to configure anything).
//
// No hamburger/mobile-drawer navigation exists anywhere in this codebase —
// the nav is a single always-visible horizontally-scrollable row at every
// viewport width (see TopBar.tsx: no mobile menu toggle). So "mobile"
// mega-menu here means: the same flyout, tap-to-open instead of hover-only,
// with its columns wrapping (flex-wrap) onto their own lines once they no
// longer fit the viewport width, rather than a genuine accordion-in-a-drawer
// that has nothing to live inside.
export default function MenuBar() {
  const { shopSlug, shopBasePath, previewToken, previewMode, themeConfig } = useShop();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [openMegaId, setOpenMegaId] = useState<number | null>(null);
  const [megaTop, setMegaTop] = useState(0);
  const [megaLeft, setMegaLeft] = useState(0);
  const navRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getMenu(shopSlug, previewToken)
      .then(setItems)
      .catch(() => setItems([]));
  }, [shopSlug, previewToken]);

  // left is the triggering item's own left edge, not the nav row's — the
  // panel opens flush with the item that triggered it (clamped against the
  // right edge of the viewport by MegaMenuPanel itself), not stretched to
  // the page edge.
  function openMega(id: number, triggerEl: HTMLElement) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (navRef.current) setMegaTop(navRef.current.getBoundingClientRect().bottom);
    setMegaLeft(triggerEl.getBoundingClientRect().left);
    setOpenMegaId(id);
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenMegaId(null), 100);
  }
  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  if (items === null) return null;
  if (items.length === 0) return <CollectionNav />;

  const navBlock = themeConfig?.header.blocks.find((b) => b.type === "nav_menu");
  const menuBarBackground = resolveMenuBarBackground(themeConfig?.header.settings);
  const navStyle = {
    ...(navBlock ? resolveNavElementStyle(navBlock.settings) : {}),
    ...(menuBarBackground ? { background: menuBarBackground } : {}),
  };
  const showOnMobile = navBlock?.settings.showOnMobile !== false;
  const menuAnimation = (themeConfig?.header.settings.menuAnimation as "fade" | "slide" | "none" | undefined) ?? "fade";
  const linkClass = "theme-nav-link px-3 py-1.5 rounded-full whitespace-nowrap text-zinc-600 hover:bg-mouse-over/10 transition-colors";

  const openItem = items.find((i) => i.id === openMegaId && i.type === "MEGA");

  return (
    <nav
      ref={navRef}
      className={`border-t border-stroke ${showOnMobile ? "" : "hidden md:block"}`}
      style={navStyle}
      {...(navBlock ? editableAttrs(previewMode, { id: navBlock.id, sectionId: HEADER_CHROME_ID, type: "nav_menu" }) : {})}
    >
      <div className="mx-auto max-w-7xl px-2 sm:px-4 flex items-center gap-1 py-2 text-sm overflow-x-auto">
        <Link href={shopBasePath || "/"} className={linkClass}>
          Home
        </Link>
        {items.map((item) => (
          <MenuBarItem
            key={item.id}
            item={item}
            linkClass={linkClass}
            shopBasePath={shopBasePath}
            isMegaOpen={openMegaId === item.id}
            onMegaEnter={(el) => openMega(item.id, el)}
            onMegaLeave={scheduleClose}
          />
        ))}
      </div>
      {openItem && (
        <MegaMenuPanel item={openItem} top={megaTop} left={megaLeft} animation={menuAnimation} onMouseEnter={cancelClose} onMouseLeave={scheduleClose} />
      )}
    </nav>
  );
}

function MenuBarItem({
  item,
  linkClass,
  shopBasePath,
  isMegaOpen,
  onMegaEnter,
  onMegaLeave,
}: {
  item: MenuItem;
  linkClass: string;
  shopBasePath: string;
  isMegaOpen: boolean;
  onMegaEnter: (triggerEl: HTMLElement) => void;
  onMegaLeave: () => void;
}) {
  const { cssStyle, handlers } = useNavItemStyle(item.style);

  if (item.type === "LINK") {
    return item.collection ? (
      <Link href={`${shopBasePath}/collections/${item.collection.slug}`} className={linkClass} style={cssStyle} {...handlers}>
        {item.label}
      </Link>
    ) : null;
  }

  if (item.type === "MEGA") {
    return (
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={isMegaOpen}
        onMouseEnter={(e) => onMegaEnter(e.currentTarget)}
        onMouseLeave={onMegaLeave}
        onClick={(e) => (isMegaOpen ? onMegaLeave() : onMegaEnter(e.currentTarget))}
        className={`${linkClass} cursor-pointer shrink-0`}
        style={cssStyle}
        {...handlers}
      >
        {item.label}
      </button>
    );
  }

  // DROPDOWN
  return (
    <div className="relative group shrink-0">
      <button type="button" aria-haspopup="true" className={`${linkClass} cursor-pointer`} style={cssStyle} {...handlers}>
        {item.label}
      </button>
      <div className="absolute left-0 top-full z-20 hidden group-hover:block group-focus-within:block pt-1">
        <div className="min-w-48 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg py-2">
          <span className="block px-3 pb-1 text-xs font-semibold text-zinc-400">{item.label}</span>
          <ul className="space-y-0.5">
            {item.collections.map((c) =>
              c.collection ? (
                <li key={c.collectionId}>
                  <Link
                    href={`${shopBasePath}/collections/${c.collection.slug}`}
                    className="block px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    {c.collection.name}
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
