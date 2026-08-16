"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, X } from "lucide-react";
import { isTrustedAdminOrigin } from "@/lib/theme-preview-origin";

// Preview-mode-only (mounted by ShopLayoutClient.tsx only when
// useShop().previewMode is true — never for a real shopper visit, so this
// entire component and its event listeners simply don't exist outside the
// admin builder's iframe). Double-click any element tagged with
// data-requital-editable="true" (see lib/editable-attrs.ts, applied
// throughout theme-sections/*) to select it: shows a blue outline + a
// floating toolbar, and — for elements additionally tagged
// data-requital-reorderable="true" — makes it draggable among its section
// siblings.
//
// Deliberately uses ONE document-level listener per event type (delegation
// via closest()) rather than a per-element wrapper component: the element
// tree already renders through many different section components (Hero,
// Header, ProductGrid, ...), and a single global listener means adding a
// new taggable element anywhere is just "add the data attributes," not
// "also wire up handlers." Overlay/toolbar/drop-indicator are portaled to
// document.body so position:fixed coordinates from getBoundingClientRect()
// are never fought by an ancestor's own transform/overflow.
//
// Selection-clearing note: a plain single click that lands inside a
// section but not on a specific tagged element still triggers
// SectionWrapper's own pre-existing click-to-select-the-section behavior
// (unchanged, not this component's concern) — this component only hides
// its OWN outline/toolbar in that case, it does not post element-deselected
// for every such click (that would race against SectionWrapper's own
// postMessage from the same click and could undo a legitimate section
// selection). element-deselected is posted only for the toolbar's explicit
// close button — a deliberate, unambiguous deselect action.
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
  cta: "Button",
  logo: "Logo",
  nav_menu: "Menu",
  collection_title: "Heading",
  view_all_button: "Button",
  product_title: "Product title",
  product_price: "Price",
  text: "Text",
  image: "Image",
  footer_copyright: "Footer text",
  email_form: "Button",
};

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
  // scroll delta alone (e.g. a responsive breakpoint change).
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
    function handleDoubleClick(e: MouseEvent) {
      const el = findEditable(e.target);
      if (!el) return;
      e.preventDefault(); // no native text-selection on double-click
      const id = el.dataset.requitalId;
      const sectionId = el.dataset.requitalSection;
      const elementType = el.dataset.requitalType;
      if (!id || !sectionId || !elementType) return;
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

    // Clicking outside any editable element hides this component's own
    // outline/toolbar — see the file-level comment for why this does not
    // also post element-deselected.
    function handleClick(e: MouseEvent) {
      if (!findEditable(e.target)) setSelected(null);
    }

    document.addEventListener("dblclick", handleDoubleClick);
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("dblclick", handleDoubleClick);
      document.removeEventListener("click", handleClick);
    };
  }, []);

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

  if (typeof document === "undefined") return null;

  return createPortal(
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
            onClick={handleClose}
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
    </>,
    document.body,
  );
}
