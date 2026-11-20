"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, EyeOff, Eye, Minus, Plus } from "lucide-react";
import { STOREFRONT_URL, storefrontUrlFor, getThemePreviewToken, listCollections, listProducts } from "@/lib/api";
import SelectionActionBar from "./SelectionActionBar";
import DropdownMenu from "@/components/ui/DropdownMenu";
import type { Shop, Collection, Product } from "@/lib/types";
import {
  HEADER_CHROME_ID,
  FOOTER_CHROME_ID,
  type BlockContainerRef,
  type ThemeEditorState,
  type DevicePreview,
} from "@/lib/useThemeEditor";
import { SECTION_TYPE_LABELS, type ThemeConfig } from "@/lib/types";

// Fixed device widths in CSS pixels; desktop fills the stage (divided by the zoom, so zooming out
// shows a wider desktop viewport).
const DEVICE_WIDTH_PX: Record<Exclude<DevicePreview, "desktop">, number> = {
  tablet: 768,
  mobile: 390,
};

export const ZOOM_STEPS = [25, 50, 67, 75, 90, 100, 110, 125, 150] as const;
// The stage's inner padding around the preview card, per side.
const STAGE_PAD = 16;

/**
 * The preview card's geometry for a stage size, device and zoom. "fit" = the largest zoom (at most
 * 100%) at which the device width fits the stage. The card is the visible (scaled) box; the iframe
 * inside it is laid out at frameWidth x frameHeight and scaled by `scale`, so the storefront's own
 * scrollbar is the only vertical scrollbar.
 */
export function previewGeometry(
  stage: { width: number; height: number },
  device: DevicePreview,
  zoom: number | "fit",
): { scale: number; frameWidth: number; frameHeight: number; cardWidth: number; cardHeight: number } {
  const availW = Math.max(0, stage.width - STAGE_PAD * 2);
  const availH = Math.max(0, stage.height - STAGE_PAD * 2);
  const deviceW = device === "desktop" ? null : DEVICE_WIDTH_PX[device];
  const fit = deviceW ? Math.min(1, availW / deviceW) : 1;
  const scale = zoom === "fit" ? fit : zoom / 100;
  const frameWidth = deviceW ?? (scale > 0 ? availW / scale : availW);
  const cardWidth = frameWidth * scale;
  const cardHeight = availH;
  return { scale, frameWidth, frameHeight: scale > 0 ? cardHeight / scale : cardHeight, cardWidth, cardHeight };
}

const POST_DEBOUNCE_MS = 150;

// Governs everything that jumps the editor to a global Theme Settings
// category instead of resolving as a normal block selection — the
// quick-add button (see storefront ProductGridSection.tsx's own
// PRODUCT_CARDS_SENTINEL_ID, duplicated here by hand, same no-shared-
// package convention as HEADER_CHROME_ID/FOOTER_CHROME_ID below) has no
// backing block of its own; it's governed entirely by
// globalSettings.productCards, a Theme Settings category, not anything in
// a section's block tree. Same "Edit scheme" jump-link pattern
// SchemePicker.tsx already uses elsewhere in this app.
const PRODUCT_CARDS_SENTINEL_ID = "__product-cards__";

// The preview's section outline protocol (mirrored by hand in storefront/lib/preview-section-selection.ts).
export const PREVIEW_SELECT_SECTION = "preview-select-section";
export const PREVIEW_SELECTION_REQUEST = "preview-selection-request";

// The builder's own accent, so the outline matches the panel's selected row (not the shop's colours).
function builderAccent(): string {
  if (typeof window === "undefined") return "#0f766e";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : "#0f766e";
}

// Mirrors storefront/lib/is-local-host.ts by hand — same no-shared-package
// convention as every other cross-app helper in this codebase.
function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local");
}

// Bug 1 root cause (found via real tracing, not guessed): the iframe src was
// built as `${STOREFRONT_URL}/${shopSlug}`, the old bare-path shape that
// stopped being correct once per-shop domains shipped (see api.ts's
// storefrontUrlFor comment) — and worse, storefront/proxy.ts REWRITES a
// real *.requital.io/custom-domain request by *prepending* its own
// resolved subdomain to whatever path is already there, so hitting a real
// hostname with a `/${shopSlug}` path double-prefixes it into a 404
// (`/acme/acme`), not just a stale-but-working link. There are genuinely
// two different correct shapes depending on how this admin app itself was
// reached:
//  - Local dev (STOREFRONT_URL resolves to a local host, matching how
//    proxy.ts's own isLocalHost() opts out of hostname rewriting): keep the
//    existing bare-path shape unchanged — this is what e2e and manual
//    local testing already rely on.
//  - Real deploy: build the per-shop real address via storefrontUrlFor
//    (subdomain or connected custom domain) with NO path segment — proxy.ts
//    supplies it from the hostname. This is also robust to exactly the
//    misconfiguration found on the VPS (NEXT_PUBLIC_STOREFRONT_URL set to
//    the bare apex domain, which just 301s to admin.requital.io) since this
//    branch never uses STOREFRONT_URL for the URL itself, only to decide
//    which branch to take.
// previewToken lets the storefront's outlets/menu/collections/products
// fetches pass PublicService's assertPublishedOrPreview check for a shop
// that hasn't published yet — the most common time to actually be in the
// builder. Without it those calls 404 (shop.published === false), which
// used to surface as a full-page "This store is unavailable" inside the
// iframe even after the frame-src/frame-ancestors CSP fixes let the iframe
// load at all — see PublicService.isAuthorizedPreview for the verification
// side.
//
// Session-cookie migration (security audit finding #1), phase 2 — this
// used to be the staff member's own real access token, read synchronously
// out of localStorage. Now that it's an httpOnly cookie unreadable by JS,
// the component below fetches a separate, narrow, short-lived
// `theme_preview` token instead (see ThemesService.issuePreviewToken) and
// passes it in here — the token is embedded once, at src-build time, and
// only refreshed by remounting the iframe — a theme-id change, or a
// successful publish (see publishVersion below); there's no more manual
// "Refresh preview" button to fall back on (removed — a reliably
// auto-updating preview shouldn't need one). A preview session left open
// past the token's own 15-minute lifetime without either of those will see
// this content fall back to empty rather than erroring, since every one of
// those storefront fetches already catches its own failure — an accepted
// edge case, not worth wiring a live token-refresh mechanism into the
// iframe for.
// path is a real storefront route past the shop segment (e.g.
// "/collections/some-slug"), or "" for the homepage — see PageSwitcher
// below. Appended before the query string exactly like a real in-preview
// link click would produce, so this goes through the same URL shape
// shop-context.tsx's sessionStorage preview-persistence fix already covers.
function resolvePreviewUrl(
  shop: Shop,
  themeId: number,
  path: string,
  previewToken: string | null,
): string | null {
  const tokenParam = previewToken ? `&previewToken=${encodeURIComponent(previewToken)}` : "";

  const storefrontHostname = (() => {
    try {
      return new URL(STOREFRONT_URL).hostname;
    } catch {
      return null;
    }
  })();

  if (storefrontHostname && isLocalHost(storefrontHostname)) {
    return `${STOREFRONT_URL}/${shop.subdomain}${path}?preview=true&themeId=${themeId}${tokenParam}`;
  }

  try {
    const base = storefrontUrlFor(shop);
    // Defensive: never actually point a "production" preview at a local
    // address — if it somehow resolved to one (e.g. a misconfigured root
    // domain env var), treat it as unresolvable rather than loading a dead
    // iframe silently.
    if (isLocalHost(new URL(base).hostname)) return null;
    return `${base}${path}?preview=true&themeId=${themeId}${tokenParam}`;
  } catch {
    return null;
  }
}

// Bug 3's explicit ask: a real toolbar control to jump the preview to a
// different page template directly (setting the iframe's src, same as
// clicking a real link would), instead of the merchant's only option being
// an in-preview link click. Home/Collection/Product are the three route
// shapes theme sections actually render into (see theme-config.types.ts) —
// Cart/Checkout aren't section-driven pages this builder edits, so they're
// intentionally left out of this switcher rather than padded in for
// completeness. Picks the shop's first real collection/product as "the"
// page to preview — a full per-item picker is more than a page switcher
// needs; a merchant with zero collections/products yet just doesn't get
// those two options (rather than linking to a slug that 404s).
// The settings search lives in BuilderSettingsSearch.tsx (it searches the whole builder).

export function PreviewPageSelector({
  previewPath,
  setPreviewPath,
}: {
  previewPath: string;
  setPreviewPath: (path: string) => void;
}) {
  // Bug 4's ask: show the actual collection/product being previewed by
  // name, with a picker when more than one exists - fetch the full lists
  // rather than just the first item of each, grouped under "Collections"/
  // "Products" headers. Originally a native <select>+<optgroup> (grouping
  // and the matched option's own label as closed-state text come free from
  // the platform) - rebuilt as a real DropdownMenu because a native
  // popup's option list can't be given a minimum width, per-row padding,
  // muted/smaller group headers, indentation, or an open animation, all of
  // which are OS chrome the platform doesn't expose to CSS. B10's
  // storefront Sort-by needed the same kind of hand-rolled dropdown for
  // the identical reason.
  const [collections, setCollections] = useState<Collection[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    listCollections().then(setCollections).catch(() => setCollections([]));
    listProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  const currentLabel =
    previewPath === ""
      ? "Home"
      : (collections.find((c) => `/collections/${c.slug}` === previewPath)?.name ??
        products.find((p) => `/products/${p.slug}` === previewPath)?.name ??
        "Home");

  function Option({ value, label, onSelect }: { value: string; label: string; onSelect: () => void }) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
      >
        <span className="truncate">{label}</span>
        {previewPath === value && <Check className="size-3.5 shrink-0 text-accent" />}
      </button>
    );
  }

  function GroupHeader({ children }: { children: ReactNode }) {
    return (
      <p className="mt-3 mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-zinc-400 first:mt-0">
        {children}
      </p>
    );
  }

  return (
    <DropdownMenu
        align="left"
        panelClassName="min-w-[240px] max-h-96 overflow-y-auto"
        trigger={({ toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-label={`Preview page: ${currentLabel}`}
            className="flex h-8 max-w-56 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] dark:border-white/15 dark:bg-zinc-900"
          >
            <span className="shrink-0 text-text-muted">Page:</span>
            <span className="truncate font-medium">{currentLabel}</span>
            <ChevronDown className="size-3.5 shrink-0 text-text-faint" />
          </button>
        )}
      >
        {(close) => (
          <>
            <Option value="" label="Home" onSelect={() => { setPreviewPath(""); close(); }} />
            {collections.length > 0 && (
              <>
                <GroupHeader>Collections</GroupHeader>
                <div className="ps-2">
                  {collections.map((c) => (
                    <Option
                      key={c.id}
                      value={`/collections/${c.slug}`}
                      label={c.name}
                      onSelect={() => { setPreviewPath(`/collections/${c.slug}`); close(); }}
                    />
                  ))}
                </div>
              </>
            )}
            {products.length > 0 && (
              <>
                <GroupHeader>Products</GroupHeader>
                <div className="ps-2">
                  {products.map((p) => (
                    <Option
                      key={p.id}
                      value={`/products/${p.slug}`}
                      label={p.name}
                      onSelect={() => { setPreviewPath(`/products/${p.slug}`); close(); }}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
    </DropdownMenu>
  );
}

// Live preview: every config edit is posted to the iframe (debounced, so a
// fast typing burst doesn't flood postMessage), no save/reload needed to
// see it reflected — per the spec. The iframe itself only remounts on a
// theme-id change or a successful publish (publishVersion), never on a
// plain edit/autosave — and there's no manual "Refresh preview" button to
// fall back on if that pipeline is ever wrong, which is deliberate: it
// forces every config-change path to actually go through the postMessage
// effect below rather than "just click refresh" papering over a real gap.
// Explicit target origin throughout, never '*'. The reverse channel
// (clicking a section inside the preview selects it here) is the
// same window 'message' listener, discriminated by payload type.
export default function PreviewFrame({
  editor,
  shop,
}: {
  editor: ThemeEditorState;
  shop: Shop;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const legacyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { theme, config, legacyTheme, device, selectNode, setEditorMode, setThemeSettingsCategory, reorderBlocks, reorderSections, publishVersion, isDragging, previewPath } = editor;
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | "fit">("fit");
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    // ResizeObserver reports the initial size too (asynchronously); rAF covers environments without it.
    if (typeof ResizeObserver === "undefined") {
      const id = requestAnimationFrame(measure);
      return () => cancelAnimationFrame(id);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The reverse-channel listener below reads this instead of closing over
  // `config` directly, so that effect doesn't need `config` in its
  // dependency array — without this, the listener would tear down and
  // re-register on every single edit (config changes on every keystroke,
  // not just a reorder), which is unnecessary churn on exactly the
  // mechanism a "does the listener survive/reattach correctly" bug report
  // would suspect first.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  // What is selected right now, for the deselect handler below (same no-resubscribe reasoning).
  const selectionKindRef = useRef(editor.selection?.kind ?? null);
  useEffect(() => {
    selectionKindRef.current = editor.selection?.kind ?? null;
  }, [editor.selection?.kind]);
  // The selected SECTION as the preview draws it (outline + name chip, storefront
  // PreviewSectionOutline.tsx). The admin is the one source of truth: a click in the preview comes
  // back here as theme-section-selected, and this sends the resulting selection down again, so the
  // tree and the preview always agree.
  const selectedSectionForOutline = editor.selection?.kind === "section" ? editor.selection.section : null;
  const outlineMessage = selectedSectionForOutline
    ? {
        type: PREVIEW_SELECT_SECTION,
        sectionId: selectedSectionForOutline.id,
        label: SECTION_TYPE_LABELS[selectedSectionForOutline.type] ?? "",
        color: builderAccent(),
      }
    : { type: PREVIEW_SELECT_SECTION, sectionId: null };
  const outlineKey = selectedSectionForOutline ? `${selectedSectionForOutline.id}|${selectedSectionForOutline.type}` : "";
  const outlineMessageRef = useRef(outlineMessage);
  useEffect(() => {
    outlineMessageRef.current = outlineMessage;
  });

  // Session-cookie migration (security audit finding #1), phase 2 — fetches
  // the short-lived theme_preview token resolvePreviewUrl needs (see that
  // function's own comment). Re-fetched on the same triggers the iframe
  // itself remounts on (theme-id change, a successful publish) — src stays
  // null (iframe doesn't load yet) until this settles, one way or the
  // other, so the preview never has to do a second navigation once a token
  // shows up moments after the first render.
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [previewTokenReady, setPreviewTokenReady] = useState(false);
  useEffect(() => {
    if (!theme) {
      setPreviewToken(null);
      setPreviewTokenReady(true);
      return;
    }
    let cancelled = false;
    setPreviewTokenReady(false);
    getThemePreviewToken(theme.id)
      .then((res) => {
        if (!cancelled) setPreviewToken(res.previewToken);
      })
      .catch(() => {
        if (!cancelled) setPreviewToken(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewTokenReady(true);
      });
    return () => {
      cancelled = true;
    };
    // theme?.id, not the whole theme object — theme's own reference
    // changes on every save/autosave, and this must only re-fetch on a
    // genuine theme switch or publish, same reasoning resolvePreviewUrl's
    // old call site already applied via theme.id below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme?.id, publishVersion]);

  // Bug 2 root cause (confirmed empirically, not the "iframe navigation"
  // premise it was originally reported as — see PR description): an iframe
  // is a separate browsing context that owns pointer events physically
  // over it, regardless of navigation, and @dnd-kit's PointerSensor never
  // calls setPointerCapture to survive that (confirmed reading
  // @dnd-kit/core's source — its move/end listeners are plain
  // addEventListener calls on the original drag-handle element). A drag
  // gesture whose pointer path crosses this iframe's rect — very possible
  // given the layout below (a 256px-wide tree panel with this iframe
  // immediately to its right) — silently loses every further pointermove
  // AND pointerup for that gesture the instant the cursor enters it,
  // leaving dnd-kit's sensor stuck mid-drag forever (no pointerup ever
  // observed to end it), which is what breaks every later drag too.
  // isDragging (true for the duration of any drag, in SectionTree.tsx or
  // any TreeNode.tsx level) disables pointer-events on the iframe for
  // exactly that window, which keeps the browser's hit-testing resolving
  // to the parent document instead — confirmed empirically the pointer
  // events (including the pointerup that was previously lost entirely)
  // correctly reach the parent document once this is applied.
  const src =
    theme && previewTokenReady
      ? resolvePreviewUrl(shop, theme.id, previewPath, previewToken)
      : null;
  const previewOrigin = useMemo(() => {
    if (!src) return null;
    try {
      return new URL(src).origin;
    } catch {
      return null;
    }
  }, [src]);

  // [PREVIEW-DIAG] Fires whenever the Preview page dropdown (or anything
  // else touching previewPath/theme.id) changes the iframe's target URL —
  // logs the full resolved URL including query params, so we can confirm
  // or rule out "the dropdown drops preview=true/themeId/previewToken."
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[PREVIEW-DIAG:admin] preview src changed", { previewPath, src, previewOrigin });
  }, [previewPath, src, previewOrigin]);

  // Guards the two debounced postMessage calls below (and the reverse-
  // channel listener's own reliance on previewOrigin) against a real race:
  // a `src` change starts a genuine cross-document navigation, but
  // `iframeRef.current.contentWindow` still points at the outgoing
  // document (often still `about:blank`, same-origin as this admin page)
  // until the new document actually finishes loading. A debounced post
  // firing in that window targets `previewOrigin` (the NEW document's
  // origin) against a `contentWindow` that isn't there yet, which throws
  // "target origin ... does not match the recipient window's origin"
  // synchronously — confirmed live via puppeteer during the DnD
  // investigation this guard came out of. Harmless in that the next
  // `onLoad` resync (handleIframeLoad below) always recovers it, but it's
  // an uncaught throw and a noisy console error in the meantime. Reset to
  // false on every src change (navigation just started, not loaded yet),
  // set true once handleIframeLoad's `load` event actually fires.
  const iframeReadyRef = useRef(false);
  useEffect(() => {
    if (!previewOrigin || !iframeReadyRef.current) return;
    iframeRef.current?.contentWindow?.postMessage(outlineMessageRef.current, previewOrigin);
  }, [outlineKey, previewOrigin]);
  useEffect(() => {
    iframeReadyRef.current = false;
  }, [src]);

  // Structural changes (a reorder, today — add/remove-block would be a
  // natural extension of the same call site) skip the debounce entirely.
  // The debounce exists to coalesce a rapid burst of VALUE edits (dragging
  // a color picker, typing in a text field) into one postMessage instead of
  // one per keystroke — a reorder is a single discrete drop, there's
  // nothing to coalesce, and debouncing it means the merchant sees no
  // visual change for up to POST_DEBOUNCE_MS after releasing the drag,
  // which reads as "the drop did nothing" (confirmed live: the section
  // sits frozen through that whole window before silently snapping into
  // place). postConfigImmediate posts right away and flags the upcoming
  // debounced effect run to skip its own post — the effect still fires
  // (config changing is what it's watching, and it can't distinguish "why"
  // from its own dependency array), but this makes it a no-op rather than
  // a redundant, harmless-but-wasteful repost of the same config.
  const suppressNextDebouncedPostRef = useRef(false);
  function postConfigImmediate(cfg: ThemeConfig) {
    if (!previewOrigin || !iframeReadyRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    suppressNextDebouncedPostRef.current = true;
    iframeRef.current?.contentWindow?.postMessage({ type: "theme-config-update", config: cfg }, previewOrigin);
  }

  useEffect(() => {
    if (!config || !previewOrigin) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (suppressNextDebouncedPostRef.current) {
        suppressNextDebouncedPostRef.current = false;
        return;
      }
      if (!iframeReadyRef.current) return;
      iframeRef.current?.contentWindow?.postMessage(
        { type: "theme-config-update", config },
        previewOrigin,
      );
    }, POST_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [config, previewOrigin]);

  // Layout mode's 13 categories (button shape, button fill, menu bar,
  // homepage layout, ...) live in the separate legacy `themesettings` row
  // (editor.legacyTheme), not theme.config — this is the second, symmetric
  // half of lifting that state into useThemeEditor (see that file's own
  // comment): a legacyTheme change now has exactly one shared piece of
  // state to watch, the same way a theme.config change already does above.
  // Same 200ms debounce, same explicit-origin-never-'*' rule, deliberately
  // a second message type rather than folding these fields into
  // theme-config-update — legacyTheme and config are genuinely different
  // JSON shapes from two different backend endpoints, not one config with
  // two names for the same data.
  useEffect(() => {
    if (!legacyTheme || !previewOrigin) return;
    if (legacyDebounceRef.current) clearTimeout(legacyDebounceRef.current);
    legacyDebounceRef.current = setTimeout(() => {
      if (!iframeReadyRef.current) return;
      iframeRef.current?.contentWindow?.postMessage(
        { type: "legacy-theme-update", legacyTheme },
        previewOrigin,
      );
    }, POST_DEBOUNCE_MS);
    return () => {
      if (legacyDebounceRef.current) clearTimeout(legacyDebounceRef.current);
    };
  }, [legacyTheme, previewOrigin]);

  // Reverse channel from the iframe — every handler validates event.origin
  // against the resolved preview origin (never '*') before acting, same as
  // the existing theme-section-selected handling this replaces/extends.
  // element-selected/element-deselected reuse the editor's own single
  // selectedId + resolveSelection (see useThemeEditor.ts) rather than
  // tracking a separate selectedElementId here — selecting a block by id
  // already resolves its full section/container context on its own, so
  // there's nothing extra to store.
  useEffect(() => {
    if (!previewOrigin) return;
    // eslint-disable-next-line no-console
    console.log("[PREVIEW-DIAG:admin] registering window message listener", { previewOrigin });
    function handleMessage(event: MessageEvent) {
      const originMatch = event.origin === previewOrigin;
      // eslint-disable-next-line no-console
      console.log("[PREVIEW-DIAG:admin] message received", {
        originReceived: event.origin,
        originExpected: previewOrigin,
        originMatch,
      });
      if (!originMatch) {
        // eslint-disable-next-line no-console
        console.log("[PREVIEW-DIAG:admin] message REJECTED: origin mismatch", { originReceived: event.origin, originExpected: previewOrigin });
        return;
      }
      const data = event.data;
      if (!data || typeof data !== "object") {
        // eslint-disable-next-line no-console
        console.log("[PREVIEW-DIAG:admin] message REJECTED: data is not an object", { data });
        return;
      }
      // eslint-disable-next-line no-console
      console.log("[PREVIEW-DIAG:admin] message data", { type: data.type, data });

      if (data.type === "theme-section-selected" && typeof data.sectionId === "string") {
        // eslint-disable-next-line no-console
        console.log("[PREVIEW-DIAG:admin] handled: theme-section-selected", { sectionId: data.sectionId });
        selectNode(data.sectionId);
        return;
      }
      if (data.type === "element-selected" && typeof data.elementId === "string") {
        if (data.elementId === PRODUCT_CARDS_SENTINEL_ID) {
          // eslint-disable-next-line no-console
          console.log("[PREVIEW-DIAG:admin] handled: element-selected (product cards sentinel)");
          setEditorMode("theme_settings");
          setThemeSettingsCategory("Product cards");
          return;
        }
        // eslint-disable-next-line no-console
        console.log("[PREVIEW-DIAG:admin] handled: element-selected", { elementId: data.elementId });
        selectNode(data.elementId);
        return;
      }
      if (data.type === PREVIEW_SELECTION_REQUEST) {
        // The preview (re)mounted and asks what to outline.
        (event.source as Window | null)?.postMessage(outlineMessageRef.current, previewOrigin);
        return;
      }
      if (data.type === "element-deselected") {
        // The preview deselects an ELEMENT (a block): on its own navigation, on a click on empty
        // space, on its toolbar's close. It must not close a section, header, footer or announcement
        // drill-in that the merchant opened from the panel, a search result or a deep link (the
        // preview sends this every time its document mounts).
        // eslint-disable-next-line no-console
        console.log("[PREVIEW-DIAG:admin] handled: element-deselected");
        if (selectionKindRef.current === "block") selectNode(null);
        return;
      }
      // Top-level section drag (SectionWrapper.tsx, preview-mode only) —
      // reuses the same element-moved message type the block-drag system
      // below already sends, discriminated by `kind: "section"` rather than
      // routed through a second listener, per this feature's own scope (no
      // changes to PreviewInteraction.tsx's block-drag grouping, which has
      // no concept of "the top-level list of sections" to teach it).
      // Deliberately self-contained-in-iframe like the block system (one
      // committed message per drop, not a live coordinate stream) — the
      // iframe only knows its own visible siblings, so it reports intent
      // (move `sectionId` before/after `targetSectionId`) rather than a
      // full ordered id list; the full list (including any hidden
      // sections a visible-only view can't see) is assembled here from
      // configRef, then handed to reorderSections — the exact same
      // immediate-save path SectionTree.tsx's own sidebar drag already
      // uses, so both paths produce the same saved order.
      if (
        data.type === "element-moved" &&
        data.kind === "section" &&
        typeof data.sectionId === "string" &&
        typeof data.targetSectionId === "string" &&
        typeof data.before === "boolean"
      ) {
        // eslint-disable-next-line no-console
        console.log("[PREVIEW-DIAG:admin] handled: element-moved (section)", { sectionId: data.sectionId, targetSectionId: data.targetSectionId, before: data.before });
        const all = [...(configRef.current?.sections ?? [])].sort((a, b) => a.order - b.order);
        const dragged = all.find((s) => s.id === data.sectionId);
        const withoutDragged = all.filter((s) => s.id !== data.sectionId);
        const targetIndex = withoutDragged.findIndex((s) => s.id === data.targetSectionId);
        if (dragged && targetIndex !== -1) {
          const insertAt = data.before ? targetIndex : targetIndex + 1;
          const reordered = [...withoutDragged];
          reordered.splice(insertAt, 0, dragged);
          const updated = reorderSections(reordered.map((s) => s.id));
          if (updated) postConfigImmediate(updated);
        } else {
          // eslint-disable-next-line no-console
          console.log("[PREVIEW-DIAG:admin] element-moved (section): dragged or target not found in configRef", { draggedFound: !!dragged, targetIndex });
        }
        return;
      }
      if (
        data.type === "element-moved" &&
        typeof data.sectionId === "string" &&
        Array.isArray(data.orderedIds) &&
        data.orderedIds.every((id: unknown) => typeof id === "string")
      ) {
        // eslint-disable-next-line no-console
        console.log("[PREVIEW-DIAG:admin] handled: element-moved (block)", { sectionId: data.sectionId, orderedIds: data.orderedIds });
        const container: BlockContainerRef =
          data.sectionId === HEADER_CHROME_ID
            ? { kind: "header" }
            : data.sectionId === FOOTER_CHROME_ID
              ? { kind: "footer" }
              : {
                  kind: "section",
                  sectionId: data.sectionId,
                  sectionType: configRef.current?.sections.find((s) => s.id === data.sectionId)?.type ?? "hero",
                };
        const updated = reorderBlocks(container, null, data.orderedIds as string[]);
        if (updated) postConfigImmediate(updated);
        return;
      }
      // eslint-disable-next-line no-console
      console.log("[PREVIEW-DIAG:admin] message REJECTED: no handler matched this type/shape", { type: data.type, data });
    }
    window.addEventListener("message", handleMessage);
    return () => {
      // eslint-disable-next-line no-console
      console.log("[PREVIEW-DIAG:admin] unregistering window message listener", { previewOrigin });
      window.removeEventListener("message", handleMessage);
    };
  }, [previewOrigin, selectNode, setEditorMode, setThemeSettingsCategory, reorderBlocks, reorderSections]);

  // The iframe's own `load` event only fires for a genuine new-document
  // load — the initial src load, or a real full navigation/reload inside
  // it (e.g. following a plain, non-Next-<Link> anchor, or the merchant
  // hitting refresh). It does NOT fire for an in-app SPA transition
  // (clicking a themed section's Next <Link>, or browser back/forward
  // across those) — those never tear down the iframe's document, so
  // nothing there needs restoring. A hard load DOES wipe whatever
  // in-memory state the previous document had, including any live-edited
  // config/legacyTheme that had only ever reached it via postMessage and
  // was never saved — so a freshly-loaded document falls back to whatever
  // it re-fetches from the backend on mount (the last saved draft), which
  // can lag behind the merchant's actual unsaved edits. Re-posting both
  // current values immediately (no debounce — this is a one-shot resync,
  // not a rapid-edit stream) on every load closes that gap.
  function handleIframeLoad() {
    // eslint-disable-next-line no-console
    console.log("[PREVIEW-DIAG:admin] iframe onLoad fired", {
      newSrc: iframeRef.current?.src,
      previewOrigin,
      hasConfig: !!config,
      hasLegacyTheme: !!legacyTheme,
    });
    iframeReadyRef.current = true;
    if (!previewOrigin) return;
    if (config) {
      iframeRef.current?.contentWindow?.postMessage({ type: "theme-config-update", config }, previewOrigin);
    }
    if (legacyTheme) {
      iframeRef.current?.contentWindow?.postMessage({ type: "legacy-theme-update", legacyTheme }, previewOrigin);
    }
    iframeRef.current?.contentWindow?.postMessage(outlineMessageRef.current, previewOrigin);
  }

  if (!theme) return null;

  const geo = previewGeometry(stage, device, zoom);
  const percent = Math.round(geo.scale * 100);
  const selectedSection = editor.selection?.kind === "section" ? editor.selection.section : null;
  const orderedIds = config ? [...config.sections].sort((a, b) => a.order - b.order).map((sec) => sec.id) : [];
  const selectedIndex = selectedSection ? orderedIds.indexOf(selectedSection.id) : -1;

  function stepZoom(direction: 1 | -1) {
    const current = Math.round(geo.scale * 100);
    const steps = ZOOM_STEPS as readonly number[];
    const next =
      direction === 1 ? steps.find((z) => z > current) ?? steps[steps.length - 1] : [...steps].reverse().find((z) => z < current) ?? steps[0];
    setZoom(next);
  }

  function moveSelected(delta: -1 | 1) {
    if (!selectedSection) return;
    const updated = editor.moveSection(selectedSection.id, delta);
    if (updated) postConfigImmediate(updated);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-zinc-100 dark:bg-zinc-950">
      <div
        ref={stageRef}
        data-testid="preview-stage"
        className={`flex min-h-0 flex-1 justify-center overflow-y-hidden ${geo.cardWidth > stage.width ? "overflow-x-auto" : "overflow-x-hidden"}`}
        style={{ padding: STAGE_PAD }}
      >
        {src ? (
          <div
            dir="ltr"
            data-testid="preview-card"
            className="relative shrink-0 overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10"
            style={{ width: geo.cardWidth || undefined, height: geo.cardHeight || undefined }}
          >
            <iframe
              ref={iframeRef}
              key={`${theme.id}-${publishVersion}`}
              title="Storefront preview"
              src={src}
              onLoad={handleIframeLoad}
              style={{
                width: geo.frameWidth || "100%",
                height: geo.frameHeight || "100%",
                transform: geo.scale !== 1 ? `scale(${geo.scale})` : undefined,
                transformOrigin: "0 0",
                pointerEvents: isDragging ? "none" : undefined,
              }}
              className="block border-0 bg-white"
            />
            {selectedSection && (
              <>
                <div
                  data-testid="preview-selection-toolbar"
                  className="absolute end-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-black/10 bg-surface p-0.5 shadow-md dark:border-white/15 dark:bg-zinc-900"
                >
                  <ToolbarButton label="Move section up" disabled={selectedIndex <= 0} onClick={() => moveSelected(-1)}>
                    <ArrowUp className="size-3.5" />
                  </ToolbarButton>
                  <ToolbarButton
                    label="Move section down"
                    disabled={selectedIndex < 0 || selectedIndex >= orderedIds.length - 1}
                    onClick={() => moveSelected(1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </ToolbarButton>
                  <ToolbarButton label="Duplicate section" onClick={() => editor.duplicateSection(selectedSection.id)}>
                    <Copy className="size-3.5" />
                  </ToolbarButton>
                  <ToolbarButton
                    label={selectedSection.visible ? "Hide section" : "Show section"}
                    onClick={() => editor.toggleSectionVisibility(selectedSection.id)}
                  >
                    {selectedSection.visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </ToolbarButton>
                </div>
              </>
            )}
          </div>
        ) : null}
        {/* Additive-only (storefront-v2 Phase 4C) — see SelectionActionBar's
            own comment for why this doesn't touch the iframe's own
            click-to-select/drag code (owned by fix/theme-builder-dnd-select). */}
        <SelectionActionBar editor={editor} iframeRef={iframeRef} previewOrigin={previewOrigin} />
        {!src && (
          <div className="flex h-full w-full max-w-2xl flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-black/15 bg-white text-center dark:border-white/15 dark:bg-zinc-900">
            <p className="text-sm font-medium">Preview unavailable</p>
            <p className="max-w-sm text-xs text-zinc-500">
              This store&apos;s storefront address could not be resolved. Check the storefront URL configuration for this environment.
            </p>
          </div>
        )}
      </div>
      <div
        role="group"
        aria-label="Preview zoom"
        className="absolute bottom-4 end-4 z-20 flex items-center gap-0.5 rounded-full border border-black/10 bg-surface p-1 text-[12px] shadow-md dark:border-white/15 dark:bg-zinc-900"
      >
        <ToolbarButton label="Zoom out" round disabled={percent <= ZOOM_STEPS[0]} onClick={() => stepZoom(-1)}>
          <Minus className="size-3.5" />
        </ToolbarButton>
        <span className="w-11 text-center font-medium tabular-nums" aria-live="polite" data-testid="preview-zoom-value">
          {percent}%
        </span>
        <ToolbarButton label="Zoom in" round disabled={percent >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => stepZoom(1)}>
          <Plus className="size-3.5" />
        </ToolbarButton>
        <button
          type="button"
          onClick={() => setZoom("fit")}
          aria-pressed={zoom === "fit"}
          className={`h-7 cursor-pointer rounded-full px-2.5 font-medium ${zoom === "fit" ? "bg-accent-tint text-accent-text" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
        >
          Fit
        </button>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  round,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  round?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex size-7 cursor-pointer items-center justify-center text-text-muted hover:bg-black/5 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10 ${
        round ? "rounded-full" : "rounded-md"
      }`}
    >
      {children}
    </button>
  );
}
