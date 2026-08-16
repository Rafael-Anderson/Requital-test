"use client";

import { useEffect, useRef, useState } from "react";
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

// Neutralizes the real page in preview mode: no text highlighting, no
// navigating/submitting/mutating anything by clicking a real link/button/
// form. data-requital-editable elements get pointer-events restored so
// they stay clickable for selection — the click handler below still
// preventDefaults on them (blocking e.g. an <a>'s navigation) without
// relying on pointer-events alone, since a pointer-events:auto descendant
// inside a pointer-events:none ancestor link can still trigger that
// ancestor's native navigation on click (CSS hit-testing isn't the same
// thing as "this click can't activate a link").
const PREVIEW_MODE_CSS = `
  * { user-select: none !important; -webkit-user-select: none !important; }
  a, button, [role="button"] {
    pointer-events: none !important;
  }
  [data-requital-editable="true"] {
    pointer-events: auto !important;
    cursor: pointer;
  }
`;

export default function PreviewInteraction() {
  const [selected, setSelected] = useState<Selected | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ rect: DOMRect } | null>(null);
  const draggedElRef = useRef<HTMLElement | null>(null);
  const dragOrderRef = useRef<string[]>([]);
  const dragOverStateRef = useRef<{ targetId: string; before: boolean } | null>(null);

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
        // Click landed outside any tagged element — deselect for real
        // (both locally and on the admin side), not just hide this
        // component's own overlay. A real click on a real link/button
        // never gets here in the first place (pointer-events:none, see
        // PREVIEW_MODE_CSS), so this is genuinely "clicked empty space."
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
  useEffect(() => {
    if (!selected?.reorderable) return;
    const current = selected;
    const found = document.querySelector<HTMLElement>(`[data-requital-id="${CSS.escape(current.id)}"]`);
    if (!found) return;
    const el: HTMLElement = found;
    el.setAttribute("draggable", "true");

    function handleDragStart(e: DragEvent) {
      if (e.target !== el) return;
      draggedElRef.current = el;
      dragOrderRef.current = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-requital-section="${CSS.escape(current.sectionId)}"][data-requital-reorderable="true"]`,
        ),
      ).map((n) => n.dataset.requitalId!);
      e.dataTransfer?.setData("text/plain", current.id);
      requestAnimationFrame(() => el.classList.add("opacity-50"));
      postToAdmin({ type: "element-drag-start", sectionId: current.sectionId, elementId: current.id });
    }

    function handleDragOver(e: DragEvent) {
      const target = findEditable(e.target);
      if (!target || target.dataset.requitalReorderable !== "true") return;
      if (target.dataset.requitalSection !== current.sectionId) return;
      e.preventDefault();
      const targetRect = target.getBoundingClientRect();
      const before = e.clientY < targetRect.top + targetRect.height / 2;
      const lineRect = new DOMRect(targetRect.left, before ? targetRect.top - 1 : targetRect.bottom - 1, targetRect.width, 2);
      setDropIndicator({ rect: lineRect });
      dragOverStateRef.current = { targetId: target.dataset.requitalId!, before };
    }

    function handleDrop(e: DragEvent) {
      const target = findEditable(e.target);
      if (!target || target.dataset.requitalReorderable !== "true") return;
      e.preventDefault();
      const state = dragOverStateRef.current;
      const draggedId = current.id;
      if (!state || state.targetId === draggedId) return;
      const order = dragOrderRef.current.filter((id) => id !== draggedId);
      const targetIndex = order.indexOf(state.targetId);
      const insertAt = state.before ? targetIndex : targetIndex + 1;
      order.splice(insertAt, 0, draggedId);
      postToAdmin({ type: "element-moved", sectionId: current.sectionId, elementId: draggedId, orderedIds: order });
    }

    function handleDragEnd() {
      draggedElRef.current?.classList.remove("opacity-50");
      draggedElRef.current = null;
      dragOverStateRef.current = null;
      setDropIndicator(null);
    }

    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("dragend", handleDragEnd);
    return () => {
      el.removeAttribute("draggable");
      document.removeEventListener("dragstart", handleDragStart);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
      document.removeEventListener("dragend", handleDragEnd);
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
