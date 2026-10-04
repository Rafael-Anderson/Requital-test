"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    // Inside a closed <details> only its <summary> is reachable.
    const details = el.closest("details:not([open])");
    if (details && !(el.tagName === "SUMMARY" && el.parentElement === details)) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  });
}

// Everything a modal drawer owes the keyboard user, in one place (the mobile menu and the cart
// drawer both use it): Escape closes, Tab is trapped inside the panel, focus moves into the panel
// on open and back to where it came from on close, and the page behind does not scroll (the
// scrollbar's width is added back as padding so the page does not jump sideways when it vanishes).
// The panel must ALSO be `inert` while closed (callers do: it stays mounted for the slide
// transition), which is what keeps a closed panel's links out of the tab order.
export function useDialogBehavior({
  open,
  onClose,
  containerRef,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  // Latest onClose without re-running the effect (and re-stealing focus) when the caller's
  // closure changes identity on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingInlineEnd;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0 && document.documentElement.clientWidth > 0) body.style.paddingInlineEnd = `${scrollbar}px`;

    // After the panel is un-inerted and painted: inert elements cannot take focus.
    const raf = requestAnimationFrame(() => {
      if (!container) return;
      const target = container.querySelector<HTMLElement>("[data-autofocus]") ?? focusableIn(container)[0] ?? container;
      if (target === container && !container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const items = focusableIn(container);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      body.style.overflow = prevOverflow;
      body.style.paddingInlineEnd = prevPadding;
      const back = returnFocusRef?.current ?? previouslyFocused;
      if (back && back.isConnected) back.focus({ preventScroll: true });
    };
    // containerRef / returnFocusRef are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
