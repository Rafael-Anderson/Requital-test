"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { GripVertical, X } from "lucide-react";
import { isTrustedAdminOrigin } from "@/lib/theme-preview-origin";

// Preview-mode-only (mounted by ShopLayoutClient.tsx only when
// useShop().previewMode is true — never for a real shopper visit, so this
// entire component, its event listeners, and the injected <style> below
// simply don't exist outside the admin builder's iframe). Single-click any
// element tagged with data-requital-editable="true" (see
// lib/editable-attrs.ts, applied throughout theme-sections/*) to select
// it: shows a blue outline + a floating toolbar, and — for elements
// additionally tagged data-requital-reorderable="true" — makes it
// draggable among its section siblings.
//
// Single click, not double: a merchant previewing a real page full of
// links/buttons/forms needs those completely inert (no navigation, no
// form submission, no cart mutation) and needs body text to not be
// mouse-selectable, both handled by the injected <style> tag below. With
// interactive elements neutralized this way, a single click is
// unambiguous and safe to use as the selection gesture — double-click
// would just be an extra, unnecessary step.
//
// Deliberately uses ONE document-level listener per event type (delegation
// via closest()) rather than a per-element wrapper component: the element
// tree already renders through many different section components (Hero,
// Header, ProductGrid, ...), and a single global listener means adding a
// new taggable element anywhere is just "add the data attributes," not
// "also wire up handlers." Overlay/toolbar/drop-indicator are portaled to
// document.body so position:fixed coordinates from getBoundingClientRect()
// are never fought by an ancestor's own transform/overflow.
function findEditable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-requital-editable="true"]');
}

function postToAdmin(payload: Record<string, unknown>) {
  if (!document.referrer) return;
  const referrerOrigin = new URL(document.referrer).origin;
  if (!isTrustedAdminOrigin(referrerOrigin)) return;
  window.parent.postMessage(payload, referrerOrigin);
}

interface Selected {
  id: string;
  sectionId: string;
  elementType: string;
  reorderable: boolean;
}

const ELEMENT_TYPE_LABELS: Record<string, string> = {
  heading: "Heading",
  subheading: "Subheading",
  cta_button: "Button",
  logo: "Logo",
  nav_menu: "Menu",
  nav_link: "Footer links",
  search_icon: "Search icon",
  cart_icon: "Cart icon",
  account_icon: "Account icon",
  section_heading: "Section heading",
  view_all_button: "Button",
  product_title: "Product title",
  product_price: "Price",
  add_to_cart_button: "Add to cart button",
  testimonial_text: "Testimonial",
  author_name: "Author name",
  body_text: "Text",
  subtext: "Text",
  section_image: "Image",
  announcement_text: "Announcement",
  copyright_text: "Footer text",
};

// Neutralizes real form/cart actions in preview mode: no text highlighting,
// no submitting/mutating anything by clicking a real button/form. Plain
// <a> links are deliberately NOT blanket-disabled here (unlike button/
// [role=button], which always stay inert) — internal browsing (following a
// product/collection link to see how that page looks themed) is a real,
// useful part of previewing a theme; only genuinely cross-origin links get
// blocked, and only in the click handler below, since CSS alone can't tell
// same-origin from external. data-requital-editable elements get
// pointer-events restored so they stay clickable for selection — the click
// handler still preventDefaults on them regardless of tag (blocking e.g. a
// tagged <a> like the Hero CTA from navigating instead of being selected)
// without relying on pointer-events alone, since a pointer-events:auto
// descendant inside a pointer-events:none ancestor can still trigger that
// ancestor's native action on click (CSS hit-testing isn't the same thing
// as "this click can't activate the control").
const PREVIEW_MODE_CSS = `
  * { user-select: none !important; -webkit-user-select: none !important; }
  button, [role="button"] {
    pointer-events: none !important;
  }
  [data-requital-editable="true"] {
    pointer-events: auto !important;
    cursor: pointer;
  }
  [data-requital-reorderable="true"] {
    -webkit-user-drag: none;
  }
`;

export default function PreviewInteraction() {
  const pathname = usePathname();
  const [selected, setSelected] = useState<Selected | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ rect: DOMRect } | null>(null);
  const dragOrderRef = useRef<string[]>([]);
  const dragOverStateRef = useRef<{ targetId: string; before: boolean } | null>(null);

  // Reset a stale selection after navigating to a different page — the
  // previously-selected element (e.g. a Hero heading) doesn't exist on the
  // new page's DOM at all, so there's nothing to keep it selected against.
  // This is the one real piece of state that doesn't survive navigation on
  // its own: the click/drag listeners below are registered on `document`
  // once and stay valid for the component's whole lifetime regardless of
  // navigation — a client-side route change never destroys `document`
  // (this component, mounted once at the root layout, doesn't even
  // remount), and a genuine full reload remounts this whole component
  // fresh anyway (its effects re-run naturally, no manual "reinitialize"
  // step needed) — so the only real navigation-shaped bug here is exactly
  // this stale reference, not lost listeners.
  useEffect(() => {
    setSelected(null);
    postToAdmin({ type: "element-deselected" });
    // Deliberately excludes `selected`/postToAdmin from deps — this must
    // fire once per real navigation (pathname change), not every time
    // `selected` itself changes via a normal click.
  }, [pathname]);

  // Keep the overlay/toolbar glued to the selected element across
  // scroll/resize — re-measures rather than trying to transform the
  // original rect, since layout can shift for reasons unrelated to the
  // scroll delta alone (e.g. a responsive breakpoint change, or the
  // element's own content changing size after a live style edit).
  useEffect(() => {
    if (!selected) {
      setRect(null);
      return;
    }
    const current = selected;
    function measure() {
      const el = document.querySelector<HTMLElement>(`[data-requital-id="${CSS.escape(current.id)}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    }
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [selected]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const el = findEditable(e.target);
      if (!el) {
        // Click landed outside any tagged element. A real click on a real
        // button/[role=button] never gets here (pointer-events:none, see
        // PREVIEW_MODE_CSS) — those stay fully inert. A plain <a> is NOT
        // blocked by CSS, so it can genuinely be a click on one: internal
        // storefront links (every Next <Link> in theme-sections/*, which
        // is all of them today) are left alone — Link's own click handler
        // already calls preventDefault()+does its own client-side
        // transition before this document-level listener even runs, so
        // there's nothing further to do for those. Only a genuinely
        // cross-origin <a> (e.g. the footer's real social icon links) gets
        // stopped here, since nothing else would.
        const anchor = e.target instanceof Element ? e.target.closest("a") : null;
        if (anchor) {
          try {
            const url = new URL(anchor.href, document.baseURI);
            if (url.origin !== window.location.origin) {
              e.preventDefault();
            }
          } catch {
            // Malformed/non-navigating href (mailto:, tel:, javascript:) —
            // none of those leave the preview, nothing to block.
          }
        }
        if (selected) {
          setSelected(null);
          postToAdmin({ type: "element-deselected" });
        }
        return;
      }
      // Always prevent the default action (navigate/submit/etc.) for a
      // tagged element, regardless of what kind of element it is — the
      // single, centralized place this is enforced, rather than trusting
      // every current and future taggable component to remember it. See
      // the file-level comment on why pointer-events:auto alone isn't
      // sufficient for this.
      e.preventDefault();
      const id = el.dataset.requitalId;
      const sectionId = el.dataset.requitalSection;
      const elementType = el.dataset.requitalType;
      if (!id || !sectionId || !elementType) return;
      if (selected?.id === id) return; // already selected, nothing to do
      const reorderable = el.dataset.requitalReorderable === "true";
      setSelected({ id, sectionId, elementType, reorderable });
      const elRect = el.getBoundingClientRect();
      postToAdmin({
        type: "element-selected",
        sectionId,
        elementId: id,
        elementType,
        rect: { top: elRect.top, left: elRect.left, width: elRect.width, height: elRect.height },
      });
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [selected]);

  // Drag-and-drop — only wired for the currently selected element, and
  // only when it's tagged reorderable (top-level section/header/footer
  // blocks; see lib/editable-attrs.ts callers for which ones opt in).
  //
  // Pointer Events, not the HTML5 drag-and-drop API: draggable="true" +
  // dragstart/dragover/drop gave the browser's own default drag ghost (a
  // screenshot of the element trailing the cursor) and required every
  // valid drop target to call preventDefault() in dragover just to avoid
  // showing a "not allowed" cursor — both purely native-drag artifacts,
  // not anything this feature actually needs. A pointer-based drag has
  // neither problem by construction: nothing native is happening, so
  // there's no ghost to suppress and no drop-target contract to satisfy —
  // the dragged element is just repositioned with a CSS transform while
  // the pointer moves, snapped back to a real position (a reorder) on
  // release. setPointerCapture keeps move/up events routed to `el` even
  // once the cursor leaves its bounds, so the drag doesn't drop out
  // mid-gesture the way plain hover-based listeners would.
  useEffect(() => {
    if (!selected?.reorderable) return;
    const current = selected;
    const found = document.querySelector<HTMLElement>(`[data-requital-id="${CSS.escape(current.id)}"]`);
    if (!found) return;
    const el: HTMLElement = found;

    // A small movement threshold before treating this as a drag (rather
    // than a click) — pointerdown+pointerup with near-zero movement is a
    // normal click and must keep working exactly as it already does via
    // the document-level click handler above; only real movement should
    // ever engage the transform/reorder machinery below.
    const DRAG_THRESHOLD_PX = 4;
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let siblingEls: HTMLElement[] = [];

    function beginDrag() {
      dragging = true;
      el.style.willChange = "transform";
      siblingEls = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-requital-section="${CSS.escape(current.sectionId)}"][data-requital-reorderable="true"]`,
        ),
      );
      dragOrderRef.current = siblingEls.map((n) => n.dataset.requitalId!);
    }

    function updateDropTarget(clientY: number) {
      // Which sibling's vertical band the drag point currently sits in —
      // geometric containment, not elementFromPoint, so it works
      // regardless of what's actually painted on top during the drag.
      const target = siblingEls.find((sib) => {
        if (sib === el) return false;
        const r = sib.getBoundingClientRect();
        return clientY >= r.top && clientY <= r.bottom;
      });
      if (!target) {
        setDropIndicator(null);
        dragOverStateRef.current = null;
        return;
      }
      const r = target.getBoundingClientRect();
      const before = clientY < r.top + r.height / 2;
      setDropIndicator({ rect: new DOMRect(r.left, before ? r.top - 1 : r.bottom - 1, r.width, 2) });
      dragOverStateRef.current = { targetId: target.dataset.requitalId!, before };
    }

    function endDrag() {
      el.style.transform = "";
      el.style.willChange = "";
      setDropIndicator(null);
      dragOverStateRef.current = null;
      dragging = false;
      pointerId = null;
    }

    function handlePointerDown(e: PointerEvent) {
      if (e.target !== el && !el.contains(e.target as Node)) return;
      if (!e.isPrimary) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      // Capture immediately, before knowing whether this becomes a real
      // drag — deferring it into pointermove (only once the threshold is
      // crossed) let Chrome fire a spurious pointercancel on the very next
      // move in some environments; capturing up front is the more common,
      // more robust pattern and doesn't affect plain-click behavior (a
      // captured pointer still fires its native click normally on release
      // with no real movement).
      el.setPointerCapture(pointerId);
    }

    function handlePointerMove(e: PointerEvent) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        beginDrag();
        postToAdmin({ type: "element-drag-start", sectionId: current.sectionId, elementId: current.id });
      }
      // Suppress the browser's own default drag/text-selection behavior
      // while a real drag is in progress — user-select is already none
      // globally (PREVIEW_MODE_CSS), this covers the rest.
      e.preventDefault();
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // Keep the selection outline glued to the element as it moves —
      // getBoundingClientRect() already reflects the transform above, so
      // this is the same measurement the scroll/resize effect does, just
      // driven by the drag itself instead.
      setRect(el.getBoundingClientRect());
      updateDropTarget(e.clientY);
    }

    function handlePointerUp(e: PointerEvent) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      if (dragging) {
        el.releasePointerCapture(pointerId);
        const state = dragOverStateRef.current;
        const draggedId = current.id;
        if (state && state.targetId !== draggedId) {
          const order = dragOrderRef.current.filter((id) => id !== draggedId);
          const targetIndex = order.indexOf(state.targetId);
          const insertAt = state.before ? targetIndex : targetIndex + 1;
          order.splice(insertAt, 0, draggedId);
          postToAdmin({ type: "element-moved", sectionId: current.sectionId, elementId: draggedId, orderedIds: order });
        }
      }
      endDrag();
    }

    function handlePointerCancel() {
      if (pointerId !== null) el.releasePointerCapture(pointerId);
      endDrag();
    }

    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerup", handlePointerUp);
    el.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUp);
      el.removeEventListener("pointercancel", handlePointerCancel);
      el.style.transform = "";
      el.style.willChange = "";
    };
  }, [selected]);

  function handleClose() {
    setSelected(null);
    postToAdmin({ type: "element-deselected" });
  }

  // The <style> tag renders unconditionally, on both server and client —
  // deliberately NOT inside the portal below. A previous version put it
  // inside the portal and broke hydration: this component returns null
  // during SSR (no `document` in Node), so the server never renders the
  // portal at all, but the CSS tag rendered on every client mount
  // regardless of selection state — an unconditional DOM insertion into
  // document.body the server never produced, which is exactly the
  // "server and client don't match" case React's hydration warns about.
  // Splitting it out fixes that: the style tag is identical on both
  // sides, and the portal's own content is null on both sides until a
  // real selection sets state (a normal post-hydration update, not a
  // hydration mismatch).
  return (
    <>
      <style>{PREVIEW_MODE_CSS}</style>
      {typeof document !== "undefined" && createPortal(<PreviewOverlay rect={rect} selected={selected} dropIndicator={dropIndicator} onClose={handleClose} />, document.body)}
    </>
  );
}

function PreviewOverlay({
  rect,
  selected,
  dropIndicator,
  onClose,
}: {
  rect: DOMRect | null;
  selected: Selected | null;
  dropIndicator: { rect: DOMRect } | null;
  onClose: () => void;
}) {
  return (
    <>
      {rect && (
        <div
          className="pointer-events-none fixed z-[2147483000] rounded-sm"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            outline: "2px solid #2563eb",
            boxShadow: "0 0 0 4px rgba(37,99,235,0.15)",
          }}
        />
      )}
      {rect && selected && (
        <div
          className="fixed z-[2147483001] flex items-center gap-2 rounded-md bg-[#2563eb] px-2 py-1 text-xs font-medium text-white shadow-lg"
          style={{ top: Math.max(4, rect.top - 32), left: rect.left }}
        >
          {selected.reorderable && <GripVertical className="size-3.5 cursor-grab opacity-90" />}
          <span>{ELEMENT_TYPE_LABELS[selected.elementType] ?? selected.elementType}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Deselect"
            className="flex items-center justify-center rounded hover:bg-white/20"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {dropIndicator && (
        <div
          className="pointer-events-none fixed z-[2147483000] rounded-full bg-[#2563eb]"
          style={{
            top: dropIndicator.rect.top,
            left: dropIndicator.rect.left,
            width: dropIndicator.rect.width,
            height: dropIndicator.rect.height,
          }}
        />
      )}
    </>
  );
}
