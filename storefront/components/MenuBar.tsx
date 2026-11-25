"use client";

import Link from "next/link";
import { createPortal, flushSync } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useShop } from "@/lib/shop-context";
import { getMenu } from "@/lib/api";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveNavElementStyle, resolveMenuBarBackground, FONT_WEIGHT_VALUE } from "@/lib/theme-element-style";
import { resolveNavLinkStyle } from "@/lib/nav-menu-style";
import type { MenuItem, MenuItemStyle } from "@/lib/types";
import CollectionNav from "@/components/CollectionNav";
import { useMenuRowOverflow } from "@/lib/use-menu-row-overflow";
import { useMinWidth } from "@/lib/use-min-width";
import { MEGA_COLUMN_GAP, MEGA_ROW_GAP, MEGA_TRACK_MIN, megaColumnOffset, megaColumns, packMegaGroups } from "@/lib/mega-menu-layout";

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
function navItemCss(style: MenuItemStyle | null | undefined, hovered: boolean): CSSProperties {
  return {
    color: style?.textColor,
    background: hovered ? (style?.hoverBackgroundColor ?? style?.backgroundColor) : style?.backgroundColor,
    borderRadius: style?.borderRadius ? RADIUS_PX[style.borderRadius] : undefined,
    fontWeight: style?.fontWeight ? FONT_WEIGHT_VALUE[style.fontWeight] : undefined,
  };
}
function useNavItemStyle(style: MenuItemStyle | null | undefined) {
  const [hovered, setHovered] = useState(false);
  const cssStyle = navItemCss(style, hovered);
  const handlers = style?.hoverBackgroundColor
    ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
    : {};
  return { cssStyle, handlers };
}

// storefront-v2 Phase 1D — the mega menu flyout for a MEGA item, sized to
// its own columns (not full-viewport-width). Still rendered via a portal to
// document.body, not a plain absolute descendant of the nav row: from md up
// the nav row is `overflow-x-auto` for its horizontal item-scrolling behavior,
// which would clip a panel that opens below/beyond it (see the CSS
// overflow spec's "one axis auto forces the other to auto too" rule — a
// plain descendant here would get vertically clipped as well). Position is
// `fixed`, computed from the triggering item's own bounding rect (left)
// and the nav row's bottom (top) — `left` is clamped in the effect below
// so the panel never overflows the right edge of the viewport.
type MegaPanelProps = {
  item: MenuItem;
  top: number;
  left: number;
  animation: "fade" | "slide" | "none";
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

// From md up the mega menu is the full-width panel below; under md (phones) it stays the compact
// flyout it always was.
function MegaMenuPanel(props: MegaPanelProps) {
  const wide = useMinWidth(768);
  return wide ? <WideMegaMenuPanel {...props} /> : <CompactMegaMenuPanel {...props} />;
}

function megaLinkHref(link: MenuItem["columns"][number]["links"][number], shopBasePath: string) {
  return link.linkType === "COLLECTION" && link.collection
    ? `${shopBasePath}/collections/${link.collection.slug}`
    : link.linkType === "PRODUCT" && link.product
      ? `${shopBasePath}/products/${link.product.slug}`
      : (link.customUrl ?? "#");
}

type WideLayout = { track: number; placements: { col: number; top: number }[]; height: number };

function sameLayout(a: WideLayout | null, b: WideLayout) {
  return (
    !!a &&
    a.track === b.track &&
    a.height === b.height &&
    a.placements.length === b.placements.length &&
    a.placements.every((p, i) => p.col === b.placements[i].col && p.top === b.placements[i].top)
  );
}

// The desktop mega menu: edge to edge across the viewport directly under the nav row, its groups
// starting at the header's content edge (the .theme-container edge plus px-4) so they line up with
// the logo, and running to the viewport's end gutter. Groups
// are laid out by lib/mega-menu-layout.ts (as many 220 to 280px tracks as fit, each group into the
// shortest column), measured in a layout effect so the packed layout is what first paints. The DOM
// keeps the merchant's order, so Tab and screen readers follow it whatever column a group lands in.
// It only scrolls inside when it is taller than the space left under the header.
function WideMegaMenuPanel({ item, top, animation, onMouseEnter, onMouseLeave }: MegaPanelProps) {
  const { shopBasePath } = useShop();
  const areaRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [layout, setLayout] = useState<WideLayout | null>(null);
  const columnCount = item.columns.length;

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const { cols, track } = megaColumns(area.clientWidth);
      const groups = groupRefs.current.slice(0, columnCount);
      // Heights depend on the track width, so set it before reading them (one synchronous layout).
      for (const g of groups) if (g) g.style.width = `${track}px`;
      const heights = groups.map((g) => (g ? g.getBoundingClientRect().height : 0));
      const packed = packMegaGroups(heights, cols, MEGA_ROW_GAP);
      const next = { track, placements: packed.placements, height: Math.ceil(packed.height) };
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) {
      ro.observe(area);
      for (const g of groupRefs.current.slice(0, columnCount)) if (g) ro.observe(g);
    }
    window.addEventListener("resize", measure);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.ready.then(measure).catch(() => undefined);
    fonts?.addEventListener?.("loadingdone", measure);
    return () => {
      cancelled = true;
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      fonts?.removeEventListener?.("loadingdone", measure);
    };
  }, [item.id, columnCount]);

  const animationClass =
    animation === "none" ? "" : animation === "slide" ? "theme-mega-panel-slide" : "theme-mega-panel-fade";
  return createPortal(
    <div
      data-mega-panel
      data-mega-layout="wide"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        top,
        maxHeight: `calc(100dvh - ${Math.max(0, Math.round(top))}px)`,
        borderColor: "var(--color-popover-border)",
        boxShadow: "0 8px 24px rgba(15,23,22,0.08)",
      }}
      className={`fixed inset-x-0 z-40 overflow-y-auto overflow-x-hidden border-y bg-popover text-popover-fg ${animationClass}`}
    >
      {/* The groups start where the header's content starts (the .theme-container edge plus its
          px-4, so they line up with the logo) and run to the viewport's end gutter, so a wider screen
          gets more columns instead of a fixed 80rem block. Logical padding, so RTL mirrors it. */}
      <div
        className="py-6"
        style={{
          paddingInlineStart: "max(1rem, calc((100% - var(--theme-max-width, 80rem)) / 2 + 1rem))",
          paddingInlineEnd: "1rem",
        }}
      >
        <div
          ref={areaRef}
          data-mega-groups
          className={layout ? "relative" : "flex flex-wrap items-start"}
          style={layout ? { height: layout.height } : { columnGap: MEGA_COLUMN_GAP, rowGap: MEGA_ROW_GAP }}
        >
          {item.columns.map((column, i) => {
            const place = layout?.placements[i];
            return (
              <div
                key={column.id}
                ref={(el) => {
                  groupRefs.current[i] = el;
                }}
                data-mega-group
                className={`min-w-0 [overflow-wrap:anywhere] ${place ? "absolute" : ""}`}
                style={{
                  width: layout?.track ?? MEGA_TRACK_MIN,
                  ...(place && layout ? { top: place.top, insetInlineStart: megaColumnOffset(place.col, layout.track) } : {}),
                }}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-popover-fg/60 mb-2">{column.title}</p>
                <ul className="space-y-1.5">
                  {column.links.map((link) => (
                    <li key={link.id}>
                      <Link
                        href={megaLinkHref(link, shopBasePath)}
                        className={`block text-sm transition-colors hover:underline ${
                          link.featured ? "text-accent-text font-medium" : "text-popover-fg"
                        }`}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CompactMegaMenuPanel({
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
      data-mega-panel
      data-mega-layout="compact"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ top, left: adjustedLeft, borderColor: "var(--color-popover-border)", boxShadow: "0 8px 24px rgba(15,23,22,0.08)" }}
      className={`fixed z-40 w-fit max-w-[calc(100vw-2rem)] rounded-lg border bg-popover text-popover-fg ${animationClass} max-h-[70vh] overflow-y-auto`}
    >
      <div className="flex flex-wrap gap-8 px-6 py-6">
        {item.columns.map((column) => (
          <div key={column.id} className="w-48 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-popover-fg/60 mb-2">{column.title}</p>
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
                        link.featured ? "text-accent-text font-medium" : "text-popover-fg"
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
// From md up the row scrolls sideways when it is too long. Below md (the
// storefront's mobile breakpoint) it never scrolls: collapsed, it shows only
// the items that fit on one line (the rest are display:none, so neither
// visible nor focusable), and a chevron button above the row at its start
// corner, shown only when something does not fit, expands it into as many
// wrapped lines as every item needs. What fits is measured from an invisible
// zero-height copy of the row laid out with flex-wrap at the same width
// (lib/use-menu-row-overflow.ts). Submenus open on tap exactly as before; the
// row has no overflow clipping on a phone, so a dropdown is never clipped.
// `inline` (theme-builder-expansion Phase 3) — rendered inside a header row
// rather than as its own full-width bar below the header: drop the <nav>
// wrapper's border/background/centering so the row owns the layout.
export default function MenuBar({ inline = false }: { inline?: boolean } = {}) {
  const { shopSlug, shopBasePath, previewToken, previewMode, themeConfig } = useShop();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [openMegaId, setOpenMegaId] = useState<number | null>(null);
  const [megaTop, setMegaTop] = useState(0);
  const [megaLeft, setMegaLeft] = useState(0);
  const navRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const rowId = useId();
  const [expanded, setExpanded] = useState(false);
  const { fitCount, overflowing } = useMenuRowOverflow(measureRef, items);
  // Everything fits again (wider viewport, shorter menu): back to the plain row.
  if (expanded && fitCount !== null && !overflowing) setExpanded(false);

  // An open mega panel closes on Escape (focus returns to its trigger) and on a press anywhere
  // outside both the nav row and the panel.
  useEffect(() => {
    if (openMegaId === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const trigger = navRef.current?.querySelector<HTMLElement>(`[data-mega-trigger="${openMegaId}"]`);
      setOpenMegaId(null);
      trigger?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (navRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest("[data-mega-panel]")) return;
      setOpenMegaId(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openMegaId]);

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
  // Expand/collapse. The row's height is animated from what it was to what it now is (WAAPI, so it
  // self-gates on reduced motion as JS animation must); content below is pushed, never covered.
  function toggleExpanded() {
    const row = navRef.current;
    const from = row?.offsetHeight ?? 0;
    flushSync(() => {
      setOpenMegaId(null);
      setExpanded((v) => !v);
    });
    if (!row || typeof row.animate !== "function") return;
    const to = row.offsetHeight;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from === to) return;
    row.style.overflow = "clip";
    const anim = row.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: 220,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
    const done = () => {
      row.style.overflow = "";
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }

  if (items === null) return null;
  if (items.length === 0) return <CollectionNav inline={inline} />;

  const navBlock = themeConfig?.header.blocks.find((b) => b.type === "nav_menu");
  // Nav-row background, independent of the header row above it: the nav
  // block's own navRowBackgroundColor wins; otherwise fall back to the
  // shared header background (menuBarBackground / a solid header.settings
  // background). Unset ⇒ the nav row inherits whatever the header is (no
  // visual change from before this key existed).
  const navRowBackground =
    (typeof navBlock?.settings.navRowBackgroundColor === "string" && navBlock.settings.navRowBackgroundColor) ||
    resolveMenuBarBackground(themeConfig?.header.settings);
  // nav_menu.settings.style (flaw A): per-theme link treatment. Absent /
  // 'pill' → the exact pre-existing rounded-full / text-zinc-600 look, no
  // font override (byte-identical). Other treatments follow --theme-round-*,
  // the header scheme colours, and the pairing's heading font.
  const navLinkStyle = resolveNavLinkStyle(navBlock?.settings.style as string | undefined);
  const navStyle = {
    ...(navBlock ? resolveNavElementStyle(navBlock.settings) : {}),
    ...(navRowBackground ? { background: navRowBackground } : {}),
    ...(navLinkStyle.useHeadingFont ? { fontFamily: "var(--theme-heading-font, inherit)" } : {}),
  };
  const showOnMobile = navBlock?.settings.showOnMobile !== false;
  const menuAnimation = (themeConfig?.header.settings.menuAnimation as "fade" | "slide" | "none" | undefined) ?? "fade";
  // Underline-on-hover animation, default on (opt out via the nav block's
  // "Enable hover animation" toggle). Off ⇒ static hover only (the existing
  // bg tint + "Hover color" behaviour), driven purely by .theme-nav-link.
  const hoverAnimationClass = navBlock?.settings.hoverAnimation === false ? "" : "theme-nav-link--anim";
  const linkClass = `theme-nav-link ${hoverAnimationClass} whitespace-nowrap ${navLinkStyle.className}`;
  // Nav row alignment (Phase 3) — only affects the below-header bar; an
  // inline nav is aligned by its header row's own justify setting.
  const navAlign = navBlock?.settings.align;
  const alignClass = navAlign === "center" ? "justify-center" : navAlign === "right" ? "justify-end" : "";

  const openItem = items.find((i) => i.id === openMegaId && i.type === "MEGA");

  // A LINK without a collection renders nothing; dropping it here keeps the measuring copy's
  // children index-aligned with the row's.
  const shownItems = items.filter((item) => item.type !== "LINK" || item.collection);
  const collapsed = overflowing && !expanded;
  const hideFrom = collapsed && fitCount !== null ? fitCount : shownItems.length;
  const itemsRow = shownItems.map((item, index) => (
    // display:contents, so the item stays a flex child of the row; below md an item that does not
    // fit while collapsed is display:none (not focusable, not announced).
    <div key={item.id} data-menu-row-item className={`contents ${index >= hideFrom ? "max-md:hidden" : ""}`}>
      <MenuBarItem
        item={item}
        linkClass={linkClass}
        shopBasePath={shopBasePath}
        isMegaOpen={openMegaId === item.id}
        onMegaEnter={(el) => openMega(item.id, el)}
        onMegaLeave={scheduleClose}
      />
    </div>
  ));
  // The measuring copy: same items, same classes and per-item font weight, laid out with flex-wrap at
  // the row's width, zero height, invisible and inert. In flow (not absolute) so that a header grid
  // cell sized to its content still sizes to the WHOLE menu, not just the items shown collapsed.
  const measureItems = shownItems.map((item) => (
    <span
      key={item.id}
      className={`shrink-0 ${linkClass} ${item.type === "LINK" ? "" : "inline-flex items-center gap-0.5"}`}
      style={navItemCss(item.style, false)}
    >
      {item.label}
      {item.type !== "LINK" && <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />}
    </span>
  ));
  const measureClass = "flex flex-wrap items-center gap-1 text-sm h-0 overflow-hidden invisible pointer-events-none md:hidden";
  const toggleButton = overflowing ? (
    <button
      type="button"
      data-menu-toggle
      aria-expanded={expanded}
      aria-controls={rowId}
      aria-label={expanded ? "Show fewer menu items" : "Show all menu items"}
      onClick={toggleExpanded}
      className="md:hidden inline-flex size-11 shrink-0 items-center justify-center rounded-full cursor-pointer hover:bg-mouse-over/10 transition-colors"
    >
      <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
  ) : null;
  const wrapClass = expanded ? "max-md:flex-wrap" : "";
  const megaPanel = openItem ? (
    <MegaMenuPanel item={openItem} top={megaTop} left={megaLeft} animation={menuAnimation} onMouseEnter={cancelClose} onMouseLeave={scheduleClose} />
  ) : null;

  if (inline) {
    return (
      <>
        <div
          className="min-w-0"
          style={navStyle}
          {...(navBlock ? editableAttrs(previewMode, { id: navBlock.id, sectionId: HEADER_CHROME_ID, type: "nav_menu" }) : {})}
        >
          {toggleButton && <div className="flex justify-start md:hidden">{toggleButton}</div>}
          <div ref={navRef} id={rowId} data-menu-row className={`flex items-center gap-1 py-1 text-sm md:overflow-x-auto ${wrapClass}`}>
            {itemsRow}
          </div>
          <div ref={measureRef} aria-hidden="true" inert data-menu-measure className={measureClass}>
            {measureItems}
          </div>
        </div>
        {megaPanel}
      </>
    );
  }

  return (
    <nav
      className={`${showOnMobile ? "" : "hidden md:block"}`}
      style={navStyle}
      {...(navBlock ? editableAttrs(previewMode, { id: navBlock.id, sectionId: HEADER_CHROME_ID, type: "nav_menu" }) : {})}
    >
      {toggleButton && <div className="theme-container px-2 sm:px-4 flex justify-start md:hidden">{toggleButton}</div>}
      <div
        ref={navRef}
        id={rowId}
        data-menu-row
        className={`mx-auto max-w-7xl px-2 sm:px-4 flex items-center gap-1 py-2 text-sm md:overflow-x-auto ${alignClass} ${wrapClass}`}
      >
        {itemsRow}
      </div>
      <div ref={measureRef} aria-hidden="true" inert data-menu-measure className={`mx-auto max-w-7xl px-2 sm:px-4 ${alignClass} ${measureClass}`}>
        {measureItems}
      </div>
      {megaPanel}
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
  const groupRef = useRef<HTMLDivElement>(null);
  const [alignEnd, setAlignEnd] = useState(false);
  // A dropdown opens from its item's start edge; near the end of a phone-width row that would run
  // past the viewport, so it opens from the item's end edge instead. Measured as it opens (the panel
  // is display:none until then, so it is shown invisibly for one synchronous read).
  function placeDropdown() {
    const group = groupRef.current;
    const panel = group?.querySelector<HTMLElement>("[data-dropdown-panel]");
    if (!group || !panel) return;
    const { display, visibility } = panel.style;
    panel.style.visibility = "hidden";
    panel.style.display = "block";
    const width = panel.getBoundingClientRect().width;
    panel.style.display = display;
    panel.style.visibility = visibility;
    const rect = group.getBoundingClientRect();
    const rtl = getComputedStyle(group).direction === "rtl";
    const viewport = document.documentElement.clientWidth;
    setAlignEnd(rtl ? rect.right - width < 8 : rect.left + width > viewport - 8);
  }

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
        data-mega-trigger={item.id}
        onMouseEnter={(e) => onMegaEnter(e.currentTarget)}
        onMouseLeave={onMegaLeave}
        onClick={(e) => {
          // A mouse click always lands after hover has opened the panel (mouseleave closes it), so
          // it must keep it open; toggling closed here made hover-then-click shut the menu. Touch
          // and keyboard still toggle.
          const pointerType = (e.nativeEvent as PointerEvent).pointerType;
          if (pointerType === "mouse" || !isMegaOpen) onMegaEnter(e.currentTarget);
          else onMegaLeave();
        }}
        className={`${linkClass} inline-flex items-center gap-0.5 cursor-pointer shrink-0`}
        style={cssStyle}
        {...handlers}
      >
        {item.label}
        <ChevronDown className={`size-3.5 shrink-0 transition-transform ${isMegaOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
    );
  }

  // DROPDOWN
  return (
    <div ref={groupRef} className="relative group shrink-0" onPointerEnter={placeDropdown} onFocusCapture={placeDropdown}>
      <button
        type="button"
        aria-haspopup="true"
        className={`${linkClass} inline-flex items-center gap-0.5 cursor-pointer`}
        style={cssStyle}
        {...handlers}
      >
        {item.label}
        <ChevronDown
          className="size-3.5 shrink-0 transition-transform group-hover:rotate-180 group-focus-within:rotate-180"
          aria-hidden="true"
        />
      </button>
      <div
        data-dropdown-panel
        className={`absolute ${alignEnd ? "end-0" : "start-0"} top-full z-20 hidden group-hover:block group-focus-within:block pt-1`}
      >
        <div className="min-w-48 max-w-[calc(100vw-1rem)] rounded-lg border border-popover-border bg-popover text-popover-fg shadow-lg py-2">
          <span className="block px-3 pb-1 text-xs font-semibold text-popover-fg/60">{item.label}</span>
          <ul className="space-y-0.5">
            {item.collections.map((c) =>
              c.collection ? (
                <li key={c.collectionId}>
                  <Link
                    href={`${shopBasePath}/collections/${c.collection.slug}`}
                    className="block px-3 py-1.5 text-sm text-popover-fg hover:bg-mouse-over/10 transition-colors"
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
