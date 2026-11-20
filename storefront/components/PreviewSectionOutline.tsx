"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isTrustedAdminOrigin } from "@/lib/theme-preview-origin";
import {
  parseSectionSelectMessage,
  SELECTION_REQUEST_MESSAGE,
  type PreviewSectionSelection,
} from "@/lib/preview-section-selection";

// The theme builder's selected-section outline (preview mode only: ShopLayoutClient mounts this
// next to PreviewInteraction, never on the public storefront). A 2px outline in the builder's accent
// around the selected section plus its name chip at the top start corner, drawn as a fixed overlay
// with pointer-events:none, so it neither shifts the layout nor takes a click. It lives inside the
// iframe, so it follows the preview's zoom, its scroll and its direction (the chip sits on the start
// side, right in RTL). What is selected comes only from the admin (see lib/preview-section-selection.ts).

type Box = { top: number; left: number; width: number; height: number };

// Above the page, below PreviewInteraction's block overlay and drop indicator (2147483000).
const Z_INDEX = 2147482000;
const CHIP_HEIGHT = 22;

function postToAdmin(payload: Record<string, unknown>) {
  if (!document.referrer) return;
  try {
    const origin = new URL(document.referrer).origin;
    if (!isTrustedAdminOrigin(origin)) return;
    window.parent.postMessage(payload, origin);
  } catch {
    // Malformed referrer: nothing to post to.
  }
}

function sameBox(a: Box | null, b: Box | null) {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

export default function PreviewSectionOutline() {
  const [selection, setSelection] = useState<PreviewSectionSelection | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isTrustedAdminOrigin(event.origin)) return;
      const parsed = parseSectionSelectMessage(event.data);
      if (parsed === undefined) return;
      setSelection(parsed);
    }
    window.addEventListener("message", onMessage);
    // Ask for the current selection: one sent before this listener existed is lost.
    postToAdmin({ type: SELECTION_REQUEST_MESSAGE });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Follow the section while it is selected: scrolling, resizing, entrance animations and content
  // loading all move it, so its box is read once a frame (one rect read; state changes only on a move).
  useEffect(() => {
    if (!selection) return;
    let frame = 0;
    // undefined = nothing written yet for this selection, so the first frame always writes (a
    // section that is not on this page must clear the previous selection's box).
    let last: Box | null | undefined = undefined;
    const selector = `[data-requital-section-id="${CSS.escape(selection.sectionId)}"]`;
    const tick = () => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect();
      const next = r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      if (last === undefined || !sameBox(last, next)) {
        last = next;
        setBox(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [selection]);

  if (!selection || !box) return null;
  const chipInside = box.top < CHIP_HEIGHT;
  return createPortal(
    <div
      data-testid="preview-section-outline"
      data-section-id={selection.sectionId}
      aria-hidden="true"
      className="pointer-events-none fixed"
      style={{
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
        zIndex: Z_INDEX,
        outline: `2px solid ${selection.color}`,
        outlineOffset: "-2px",
      }}
    >
      {selection.label && (
        <span
          data-testid="preview-section-chip"
          className="absolute whitespace-nowrap rounded-t-md px-2 text-[11px] font-semibold leading-[22px] text-white"
          style={{
            insetInlineStart: 0,
            ...(chipInside ? { top: 0, borderEndEndRadius: 6 } : { bottom: "100%" }),
            height: CHIP_HEIGHT,
            background: selection.color,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {selection.label}
        </span>
      )}
    </div>,
    document.body,
  );
}
