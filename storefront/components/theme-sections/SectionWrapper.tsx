"use client";

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";
import { isTrustedAdminOrigin } from "@/lib/theme-preview-origin";
import { resolveScheme } from "@/lib/theme-color-scheme";
import type { SectionSettings } from "@/lib/theme-config-types";

// Bug 9 fix: Header/Footer (ThemeDrivenHeader.tsx/ThemeDrivenFooter.tsx)
// used to have their own bespoke, solid-only copy of this logic - a
// "gradient" or "image" background type (both real, selectable options in
// the same admin BackgroundControls used for every section) silently did
// nothing for Header/Footer specifically, leaving them fully transparent.
// Combined with the header's own `sticky` option, that meant whatever
// scrolled underneath (most commonly the Hero section directly below,
// itself often carrying a real background image) showed straight through
// the header, which is what actually produced the reported "header text
// overlapping a background image" symptom - not a z-index/spacing bug, a
// missing two-thirds of this function's own cases. Exported so both of
// those components reuse the exact same resolution every other section's
// background already goes through, instead of drifting out of sync again.
export function backgroundStyle(bg: SectionSettings["background"]): CSSProperties {
  if (!bg || typeof bg !== "object") return {};
  const type = bg.type as string | undefined;
  if (type === "solid" && typeof bg.color === "string") {
    return { background: bg.color };
  }
  if (type === "gradient" && typeof bg.gradientFrom === "string" && typeof bg.gradientTo === "string") {
    return { background: `linear-gradient(135deg, ${bg.gradientFrom}, ${bg.gradientTo})` };
  }
  if (type === "image" && typeof bg.imageUrl === "string") {
    // bg.imageUrl is a backend-relative upload path (e.g. /uploads/theme/...)
    // — used raw here, this 404s: the storefront and backend are different
    // origins, so a bare url(/uploads/...) resolves against the storefront's
    // own origin, which never served that file. Every other image reference
    // in this app already goes through resolveImageUrl for exactly this
    // reason (see ImageTextSection.tsx); this was the one place that didn't.
    const resolved = resolveImageUrl(bg.imageUrl);
    if (!resolved) return {};
    return { backgroundImage: `url(${resolved})`, backgroundSize: "cover", backgroundPosition: "center" };
  }
  return {};
}

// Preview-mode-only, self-contained (deliberately NOT routed through
// PreviewInteraction.tsx's generic block-drag system): that system groups
// draggable siblings by a shared `data-requital-section` value (blocks
// within ONE section), which has no notion of "the top-level list of
// sections on the page" — teaching it a second grouping concept would mean
// materially reworking its core logic, which this feature is scoped to
// avoid touching. Top-level section reordering gets its own small pointer
// implementation here instead, reusing the SAME message-type shape
// (element-drag-start / element-moved) the block system already uses, so
// PreviewFrame.tsx's existing listener can route both through one handler
// discriminated by a `kind` field, rather than adding a second listener.
//
// Mirrors the proven-working shape of PreviewInteraction.tsx's own
// nested-block drag (pointer capture, a locally-rendered drop-indicator
// line, ONE final message carrying the committed result) rather than
// streaming live coordinates for the parent to interpret on every frame —
// this app has zero parent-side drag-overlay rendering machinery to feed
// a stream into today, and building that from scratch would be a much
// larger, riskier diff for the same user-visible outcome (a handle, a live
// indicator, commit-and-save on drop) this self-contained version already
// delivers.
const TOPLEVEL_SECTION_SELECTOR = '[data-requital-toplevel-section="true"]';
const DRAG_THRESHOLD_PX = 4;

function postToAdmin(payload: Record<string, unknown>) {
  if (!document.referrer) return;
  try {
    const referrerOrigin = new URL(document.referrer).origin;
    if (!isTrustedAdminOrigin(referrerOrigin)) return;
    window.parent.postMessage(payload, referrerOrigin);
  } catch {
    // Malformed document.referrer — nothing to post to.
  }
}

function SectionDropIndicator({ rect }: { rect: DOMRect }) {
  return createPortal(
    <div
      className="pointer-events-none fixed z-[2147483000] rounded-full bg-[#2563eb]"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: 3 }}
    />,
    document.body,
  );
}

// Applies every section's shared settings (padding, background, visibility)
// — the one place SectionRenderer routes every section type through, so a
// new section type gets these for free rather than reimplementing them.
// Scroll animation is applied by ScrollAnimatedWrapper (Phase 5), which
// wraps this component rather than being folded into it.
//
// Reverse preview channel (preview mode only): clicking a section posts
// {type: 'theme-section-selected', sectionId} to window.parent so the
// admin editor's left panel can sync its selection to whatever the
// merchant clicks inside the live preview. Uses document.referrer (the
// page that loaded this iframe) as the postMessage target origin, checked
// against the same trusted-origin allowlist the incoming listener uses —
// never '*'.
export default function SectionWrapper({
  sectionId,
  settings,
  children,
}: {
  sectionId: string;
  settings: SectionSettings;
  children: ReactNode;
}) {
  const { previewMode, themeConfig } = useShop();
  const spacing = settings.spacing ?? {};
  const visibility = settings.visibility ?? "both";
  const visibilityClass =
    visibility === "desktop" ? "hidden md:block" : visibility === "mobile" ? "block md:hidden" : "";
  const scheme = resolveScheme(settings.schemeId, themeConfig?.globalSettings.colorSchemes ?? []);
  const schemeStyle: CSSProperties = scheme ? { background: scheme.background, color: scheme.text } : {};

  const sectionRef = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropIndicator, setDropIndicator] = useState<DOMRect | null>(null);
  const dragOverRef = useRef<{ targetId: string; before: boolean } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // PreviewInteraction.tsx's global preview-mode stylesheet blanket-disables
  // every <button> (`button { pointer-events: none !important }`, so a real
  // action can't accidentally fire while previewing) and only re-enables
  // elements explicitly tagged data-requital-editable="true". This handle
  // is a <button> but deliberately isn't tagged that way (it isn't a
  // selectable/editable element, just a drag affordance), so it inherits
  // that same block and is otherwise inert to every pointer event. React's
  // `style` prop can't express `!important` (assigning a value string
  // containing "!important" via the DOM style-property shorthand is
  // silently rejected by the browser, not translated to a real priority)
  // and PreviewInteraction.tsx can't be touched to special-case this one
  // handle — so this sets it imperatively via `style.setProperty(...,
  // "important")`, the one API that actually can, once the button mounts.
  const setHandleRef = useCallback((el: HTMLButtonElement | null) => {
    el?.style.setProperty("pointer-events", "auto", "important");
  }, []);

  function handleClick() {
    if (!previewMode || !document.referrer) return;
    postToAdmin({ type: "theme-section-selected", sectionId });
  }

  function handleHandlePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    const section = sectionRef.current;
    if (!section || !e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    pointerIdRef.current = e.pointerId;
    handle.setPointerCapture(e.pointerId);

    function updateDropTarget(clientY: number) {
      const siblings = Array.from(document.querySelectorAll<HTMLElement>(TOPLEVEL_SECTION_SELECTOR)).filter(
        (el) => el !== section,
      );
      const target = siblings.find((sib) => {
        const r = sib.getBoundingClientRect();
        return clientY >= r.top && clientY <= r.bottom;
      });
      if (!target) {
        dragOverRef.current = null;
        setDropIndicator(null);
        return;
      }
      const r = target.getBoundingClientRect();
      const before = clientY < r.top + r.height / 2;
      dragOverRef.current = { targetId: target.dataset.requitalSectionId!, before };
      setDropIndicator(new DOMRect(r.left, before ? r.top - 1 : r.bottom - 1, r.width, 2));
    }

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerIdRef.current) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!started) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        started = true;
        setDragging(true);
        postToAdmin({ type: "element-drag-start", kind: "section", sectionId });
      }
      ev.preventDefault();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => updateDropTarget(ev.clientY));
    }

    function endDrag() {
      handle.releasePointerCapture(pointerIdRef.current!);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setDragging(false);
      setDropIndicator(null);
      pointerIdRef.current = null;
    }

    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerIdRef.current) return;
      if (started) {
        const target = dragOverRef.current;
        if (target && target.targetId !== sectionId) {
          postToAdmin({
            type: "element-moved",
            kind: "section",
            sectionId,
            targetSectionId: target.targetId,
            before: target.before,
          });
        }
        postToAdmin({ type: "element-drag-end", kind: "section", sectionId });
      }
      dragOverRef.current = null;
      endDrag();
    }

    function onCancel(ev: PointerEvent) {
      if (ev.pointerId !== pointerIdRef.current) return;
      if (started) postToAdmin({ type: "element-drag-end", kind: "section", sectionId });
      dragOverRef.current = null;
      endDrag();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  return (
    <section
      ref={sectionRef}
      className={`${visibilityClass} ${previewMode ? "group relative cursor-pointer" : ""} ${dragging ? "opacity-60" : ""}`}
      onClick={previewMode ? handleClick : undefined}
      style={{
        paddingTop: spacing.top !== undefined ? `${spacing.top}px` : undefined,
        paddingBottom: spacing.bottom !== undefined ? `${spacing.bottom}px` : undefined,
        paddingLeft: spacing.left !== undefined ? `${spacing.left}px` : undefined,
        paddingRight: spacing.right !== undefined ? `${spacing.right}px` : undefined,
        ...schemeStyle,
        ...backgroundStyle(settings.background),
      }}
      {...(previewMode ? { "data-requital-toplevel-section": "true", "data-requital-section-id": sectionId } : {})}
    >
      {previewMode && (
        <button
          ref={setHandleRef}
          type="button"
          aria-label="Drag to reorder section"
          onPointerDown={handleHandlePointerDown}
          className="absolute left-2 top-2 z-10 flex size-7 cursor-grab items-center justify-center rounded-md border border-black/10 bg-white/90 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          style={{ touchAction: "none" }}
        >
          <GripVertical className="size-4 text-zinc-500" />
        </button>
      )}
      {children}
      {dropIndicator && <SectionDropIndicator rect={dropIndicator} />}
    </section>
  );
}
