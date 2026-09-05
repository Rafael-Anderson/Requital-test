"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Menu as MenuIcon, X, ChevronDown, Home, Search, ShoppingCart, User, Store } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { useCartDrawer } from "@/lib/cart-drawer";
import { useAuth } from "@/lib/auth";
import { getMenu } from "@/lib/api";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { MenuItem } from "@/lib/types";
import type { MobileNavMode } from "@/lib/theme-config-types";

const EDGE_ZONE_PX = 24;
const SWIPE_THRESHOLD_PX = 40;

interface FlatLink {
  id: number | string;
  label: string;
  href: string;
}

// DROPDOWN/MEGA items both flatten to a simple link list under one <details>
// accordion — a MEGA item's columns lose their grouping here (there's no
// room for named columns in a phone-width drawer/overlay), same
// simplification the desktop MegaMenuPanel's own "mobile mega-menu" comment
// in MenuBar.tsx already accepts for narrow viewports.
function flattenLinks(item: MenuItem, shopBasePath: string): FlatLink[] {
  if (item.type === "DROPDOWN") {
    return item.collections
      .filter((c) => c.collection)
      .map((c) => ({ id: c.collectionId, label: c.collection!.name, href: `${shopBasePath}/collections/${c.collection!.slug}` }));
  }
  if (item.type === "MEGA") {
    return item.columns.flatMap((col) =>
      col.links.map((l) => ({
        id: l.id,
        label: l.label,
        href:
          l.linkType === "COLLECTION" && l.collection
            ? `${shopBasePath}/collections/${l.collection.slug}`
            : l.linkType === "PRODUCT" && l.product
              ? `${shopBasePath}/products/${l.product.slug}`
              : (l.customUrl ?? "#"),
      })),
    );
  }
  return [];
}

// Same accordion renderer for drawer and fullscreen — fullscreen has more
// room but there's no correctness reason to build a second, flat-only
// variant just for that; a native <details> works fine either way.
function MenuItemRow({ item, shopBasePath, onNavigate }: { item: MenuItem; shopBasePath: string; onNavigate: () => void }) {
  if (item.type === "LINK") {
    if (!item.collection) return null;
    return (
      <Link href={`${shopBasePath}/collections/${item.collection.slug}`} onClick={onNavigate} className="block px-4 py-3 text-base border-b border-white/10">
        {item.label}
      </Link>
    );
  }
  const links = flattenLinks(item, shopBasePath);
  return (
    <details className="group border-b border-white/10">
      <summary className="flex items-center justify-between px-4 py-3 text-base cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {item.label}
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="pb-2">
        {links.map((l) => (
          <Link key={l.id} href={l.href} onClick={onNavigate} className="block px-6 py-2 text-sm opacity-80">
            {l.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

// C2 — the storefront's first real mobile nav. Mounted only when
// header.settings.mobileNav is 'drawer'|'bottom-bar'|'fullscreen'
// (ShopLayoutClient gates it before mounting at all — unset/'scroll' never
// even renders this component, so MenuBar.tsx's horizontal-scroll row stays
// completely untouched). Deliberately its own file/component rather than a
// branch inside MenuBar: 'scroll' needs zero new code path to stay
// byte-identical, and 'bottom-bar' has no menu-item fetch or hamburger at
// all — structurally different from 'drawer'/'fullscreen', not a natural
// fit inside MenuBar's existing hover-based desktop logic.
export default function MobileNav({ mode }: { mode: Exclude<MobileNavMode, "scroll"> }) {
  const { shopSlug, shopBasePath, previewToken } = useShop();
  const { count } = useCart();
  const { openDrawer } = useCartDrawer();
  const { customer } = useAuth();
  const reducedMotion = useReducedMotion();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // bottom-bar has no hamburger-triggered panel and no menu-item fetch — its
  // 5 destinations are fixed, not merchant-configured links.
  useEffect(() => {
    if (mode === "bottom-bar") return;
    getMenu(shopSlug, previewToken)
      .then(setItems)
      .catch(() => setItems([]));
  }, [mode, shopSlug, previewToken]);

  // Lock page scroll while the drawer/fullscreen panel is open.
  useEffect(() => {
    if (mode === "bottom-bar" || !open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mode, open]);

  useEffect(() => {
    if (mode === "bottom-bar" || !open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mode, open]);

  // Discrete threshold swipe-from-edge to open — 'drawer' only (a closed
  // fullscreen overlay has no edge affordance to swipe from). Tracks on
  // `document` rather than a single element (no concrete draggable element
  // exists yet while closed) — same "capture the gesture immediately,
  // track delta, threshold-gate real drag vs. a tap/scroll" shape
  // PreviewInteraction.tsx uses, adapted since there's no element to call
  // setPointerCapture on here. No live drag-follow — the CSS transition
  // handles the animation once the threshold is crossed.
  useEffect(() => {
    if (mode !== "drawer" || open) return;
    let tracking = false;
    let startX = 0;
    let startY = 0;
    function onDown(e: PointerEvent) {
      if (e.clientX > EDGE_ZONE_PX) return;
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
    }
    function onMove(e: PointerEvent) {
      if (!tracking) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) * 1.5 && dx > SWIPE_THRESHOLD_PX) {
        setOpen(true);
        tracking = false;
      }
    }
    function endTrack() {
      tracking = false;
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", endTrack);
    document.addEventListener("pointercancel", endTrack);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", endTrack);
      document.removeEventListener("pointercancel", endTrack);
    };
  }, [mode, open]);

  // Swipe the panel back off-screen to close (drawer and fullscreen both).
  //
  // Deliberately does NOT call setPointerCapture on pointerdown, unlike
  // PreviewInteraction.tsx's own drag handler. Found via the scratch-shop
  // Playwright pass (real Chromium), not caught by the jsdom-based unit
  // test: capturing the pointer immediately, on a panel that CONTAINS real
  // interactive children (the Close button, menu links), suppresses the
  // browser's synthesized "click" event on those children entirely —
  // Chromium retargets the captured pointerup to the capturing element,
  // and when the down/up targets then disagree it never synthesizes a
  // click on the original target. jsdom has no setPointerCapture at all,
  // so this never manifested in the unit test. PreviewInteraction.tsx's
  // draggable elements don't have this problem: they route clicks through
  // a separate document-level capture-phase listener, not a child's own
  // onClick. Fix: only capture once real horizontal movement confirms an
  // actual swipe, never on a plain tap/click (which releases before any
  // movement) — capture is then irrelevant to that click's own event.
  function handlePanelPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const el = panelRef.current;
    if (!el) return;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let captured = false;
    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!captured && Math.abs(dx) > 10) {
        // jsdom (unit tests) has no setPointerCapture — the optional call
        // keeps this file testable without a jsdom-specific workaround.
        el!.setPointerCapture?.(pointerId);
        captured = true;
      }
      if (Math.abs(dx) > Math.abs(dy) * 1.5 && dx < -SWIPE_THRESHOLD_PX) {
        setOpen(false);
        cleanup();
      }
    }
    function cleanup() {
      // Non-null assertions: TS doesn't carry the `if (!el) return` guard's
      // narrowing into a nested function declaration's body (a known
      // control-flow-analysis limitation, not a real nullability risk here
      // — el is a const captured by closure, never reassigned).
      el!.removeEventListener("pointermove", onMove);
      el!.removeEventListener("pointerup", cleanup);
      el!.removeEventListener("pointercancel", cleanup);
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", cleanup);
    el.addEventListener("pointercancel", cleanup);
  }

  if (mode === "bottom-bar") {
    const accountHref = customer ? `${shopBasePath}/account` : `${shopBasePath}/account/login`;
    const tabClass = "flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[11px]";
    return (
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 inset-x-0 z-30 h-14 flex items-stretch border-t border-stroke bg-header text-header-fg md:hidden"
      >
        <Link href={shopBasePath || "/"} className={tabClass}>
          <Home className="size-5" />
          Home
        </Link>
        {/* No dedicated all-products/collections-index page exists in this
            app today (only collections/[slug] and products/[slug]) — Shop
            lands on the homepage, the closest existing browse destination.
            Update this href if an all-products page is ever added. */}
        <Link href={shopBasePath || "/"} className={tabClass}>
          <Store className="size-5" />
          Shop
        </Link>
        <button type="button" onClick={() => setOpen((o) => !o)} className={`${tabClass} cursor-pointer`}>
          <Search className="size-5" />
          Search
        </button>
        <button type="button" onClick={openDrawer} className={`${tabClass} relative cursor-pointer`}>
          <ShoppingCart className="size-5" />
          {count > 0 && (
            <span className="absolute top-0.5 right-1/2 translate-x-3 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-accent text-accent-foreground text-[9px] font-medium">
              {count}
            </span>
          )}
          Cart
        </button>
        <Link href={accountHref} className={tabClass}>
          <User className="size-5" />
          Account
        </Link>
      </nav>
    );
  }

  const transitionClass = reducedMotion ? "" : "transition-transform duration-300 ease-out";
  const backdropTransitionClass = reducedMotion ? "" : "transition-opacity duration-300";
  const panelTransform =
    mode === "fullscreen"
      ? open
        ? "translate-y-0"
        : "-translate-y-full"
      : open
        ? "translate-x-0"
        : "-translate-x-full";
  const panelPositionClass = mode === "fullscreen" ? "inset-0" : "inset-y-0 left-0 w-[82vw] max-w-sm";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="fixed top-3 left-3 z-30 flex items-center justify-center size-10 rounded-full bg-header text-header-fg shadow-md md:hidden"
      >
        <MenuIcon className="size-5" />
      </button>
      {createPortal(
        <div className={`fixed inset-0 z-40 md:hidden ${open ? "" : "pointer-events-none"}`}>
          <div
            onClick={() => setOpen(false)}
            className={`absolute inset-0 bg-black/40 ${backdropTransitionClass} ${open ? "opacity-100" : "opacity-0"}`}
          />
          <div
            ref={panelRef}
            onPointerDown={handlePanelPointerDown}
            aria-label="Menu"
            // The panel stays mounted at all times (so the CSS transition
            // plays on close, not just open) — role/aria-modal only apply
            // while actually open, so a closed-but-still-in-the-DOM drawer
            // never reads as an open dialog to assistive tech.
            {...(open ? { role: "dialog", "aria-modal": true } : { "aria-hidden": true })}
            className={`absolute ${panelPositionClass} bg-header text-header-fg shadow-xl overflow-y-auto ${transitionClass} ${panelTransform}`}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <span className="text-sm font-semibold">Menu</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="flex items-center justify-center size-8">
                <X className="size-5" />
              </button>
            </div>
            {(items ?? []).map((item) => (
              <MenuItemRow key={item.id} item={item} shopBasePath={shopBasePath} onNavigate={() => setOpen(false)} />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
