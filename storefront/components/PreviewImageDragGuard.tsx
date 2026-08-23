"use client";

import { useEffect } from "react";

// Preview-mode-only (mounted by ShopLayoutClient.tsx only when
// useShop().previewMode is true, same convention as PreviewInteraction.tsx/
// WhatsAppFloatingButton.tsx). PreviewInteraction.tsx's PREVIEW_MODE_CSS
// already sets `img { -webkit-user-drag: none }`, but that's a WebKit-only
// pseudo-standard property — Firefox ignores it outright and still starts a
// native drag (with the browser's own grey ghost image) on any <img>, since
// per the HTML spec an <img> is draggable by default. The only cross-browser
// way to stop that is the `draggable` attribute/IDL property itself.
//
// Set via the DOM directly rather than a `draggable={false}` JSX prop at
// each render site: images render throughout ~18 independent section/layout
// components (no single shared <Image> wrapper exists in this codebase to
// add the prop to once), so touching every one of them for a preview-only
// concern would be a large, scattered diff for a small fix. An initial pass
// over every <img> already on the page, plus a MutationObserver for images
// that mount later (lazy-loaded product images, a slideshow swap, a preview
// navigation to a different page), covers all of them from one place.
export default function PreviewImageDragGuard() {
  useEffect(() => {
    function disable(img: Element) {
      (img as HTMLImageElement).draggable = false;
    }
    document.querySelectorAll("img").forEach(disable);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.tagName === "IMG") disable(node);
          node.querySelectorAll?.("img").forEach(disable);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
