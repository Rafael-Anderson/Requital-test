"use client";

import { useEffect, useState, type RefObject } from "react";
import { Settings, Trash2 } from "lucide-react";
import Tooltip from "@/components/ui/Tooltip";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

interface SelectedBar {
  elementId: string;
  top: number;
  left: number;
}

// storefront-v2 Phase 4C — a floating Settings/Delete bar anchored over the
// selected element's blue outline box, WITHOUT touching PreviewInteraction.tsx
// (the iframe-side click-to-select + drag component that draws that outline)
// or PreviewFrame.tsx's own existing message listener — both owned by the
// parallel fix/theme-builder-dnd-select PR. This is a second, independent
// `window.message` subscription to the exact same postMessage traffic
// PreviewInteraction.tsx already broadcasts (element-selected already
// carries a `rect`, unused by the existing listener); purely additive and
// read-only, it changes nothing about how selection/drag actually work.
// Rendered as a sibling of the <iframe> in the admin's own page (not
// inside the iframe's DOM), positioned via iframeRef's own on-screen rect
// plus the received element rect — visually anchored to the right spot
// without needing any iframe-side DOM access. The position is computed
// once, inside the message handler (an event-handler context, not render)
// and stored as plain state — reading iframeRef.current during render
// itself is a real bug, not just a lint nit: nothing forces a re-render
// once the iframe finishes loading after this component's first render, so
// a render-time read could leave the bar permanently unpositioned.
//
// Known gap: whole-section/header/footer selection (SectionWrapper.tsx's
// separate `theme-section-selected` message) carries no rect, so the bar
// only ever appears for element-level (block) selections, not section
// ones — section/header/footer delete already has its own Trash2 button on
// every SectionTree row, so this isn't a lost capability, just a narrower
// surface for the new in-preview affordance specifically. Also doesn't
// re-track position if the merchant scrolls the iframe's own content after
// selecting (no new message fires on scroll) — acceptable for a small
// convenience bar, not meant to be pixel-perfect through every interaction.
export default function SelectionActionBar({
  editor,
  iframeRef,
  previewOrigin,
}: {
  editor: ThemeEditorState;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  previewOrigin: string | null;
}) {
  const [bar, setBar] = useState<SelectedBar | null>(null);

  useEffect(() => {
    if (!previewOrigin) return;
    function handleMessage(event: MessageEvent) {
      if (event.origin !== previewOrigin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "element-selected" && typeof data.elementId === "string" && data.rect) {
        const iframeEl = iframeRef.current;
        if (!iframeEl) return;
        const iframeRect = iframeEl.getBoundingClientRect();
        const elRect = data.rect as { top: number; left: number };
        setBar({ elementId: data.elementId, top: iframeRect.top + elRect.top, left: iframeRect.left + elRect.left });
      } else if (data.type === "element-deselected" || data.type === "theme-section-selected") {
        setBar(null);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [previewOrigin, iframeRef]);

  // Clear if the editor's own selection changed some other way (e.g. the
  // merchant picked a different node in the tree instead of clicking
  // inside the preview) so a stale bar doesn't linger over the wrong element.
  useEffect(() => {
    setBar((current) => (current && editor.selectedId !== current.elementId ? null : current));
  }, [editor.selectedId]);

  if (!bar || !editor.selection || editor.selection.kind !== "block") return null;
  const { container, block } = editor.selection;

  return (
    <div
      className="fixed z-[60] flex items-center gap-1 rounded-md bg-zinc-900 px-1.5 py-1 shadow-lg"
      style={{ top: Math.max(4, bar.top - 36), left: bar.left }}
    >
      <Tooltip label="Settings (already showing in the panel)">
        <button
          type="button"
          aria-label="Settings"
          className="flex items-center justify-center rounded p-1 text-white hover:bg-white/10 cursor-pointer"
        >
          <Settings className="size-3.5" />
        </button>
      </Tooltip>
      <Tooltip label="Delete" align="end">
        <button
          type="button"
          aria-label="Delete"
          onClick={() => editor.removeBlock(container, block.id)}
          className="flex items-center justify-center rounded p-1 text-white hover:bg-red-500/80 cursor-pointer"
        >
          <Trash2 className="size-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}
