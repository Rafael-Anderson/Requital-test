"use client";

import { useEffect, useMemo, useRef } from "react";
import { STOREFRONT_URL, storefrontUrlFor, getAccessToken } from "@/lib/api";
import type { Shop } from "@/lib/types";
import {
  HEADER_CHROME_ID,
  FOOTER_CHROME_ID,
  type BlockContainerRef,
  type ThemeEditorState,
  type DevicePreview,
} from "@/lib/useThemeEditor";

const DEVICE_WIDTH: Record<DevicePreview, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "390px",
};

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
// previewToken (this staff member's own access token) lets the storefront's
// outlets/menu/collections/products fetches pass PublicService's
// assertPublishedOrPreview check for a shop that hasn't published yet — the
// most common time to actually be in the builder. Without it those calls
// 404 (shop.published === false), which used to surface as a full-page
// "This store is unavailable" inside the iframe even after the frame-src/
// frame-ancestors CSP fixes let the iframe load at all — see
// PublicService.isAuthorizedPreview for the verification side. The token
// is embedded once, at src-build time, and only refreshed by remounting
// the iframe — a theme-id change, or a successful publish (see
// publishVersion below); there's no more manual "Refresh preview" button
// to fall back on (removed — a reliably auto-updating preview shouldn't
// need one). A preview session left open past the access token's 15-minute
// lifetime (AuthModule's DEFAULT_TOKEN_LIFETIME) without either of those
// will see this content fall back to empty rather than erroring, since
// every one of those storefront fetches already catches its own failure —
// an accepted edge case, not worth wiring a live token-refresh mechanism
// into the iframe for.
function resolvePreviewUrl(shop: Shop, themeId: number): string | null {
  const previewToken = getAccessToken();
  const tokenParam = previewToken ? `&previewToken=${encodeURIComponent(previewToken)}` : "";

  const storefrontHostname = (() => {
    try {
      return new URL(STOREFRONT_URL).hostname;
    } catch {
      return null;
    }
  })();

  if (storefrontHostname && isLocalHost(storefrontHostname)) {
    return `${STOREFRONT_URL}/${shop.subdomain}?preview=true&themeId=${themeId}${tokenParam}`;
  }

  try {
    const base = storefrontUrlFor(shop);
    // Defensive: never actually point a "production" preview at a local
    // address — if it somehow resolved to one (e.g. a misconfigured root
    // domain env var), treat it as unresolvable rather than loading a dead
    // iframe silently.
    if (isLocalHost(new URL(base).hostname)) return null;
    return `${base}?preview=true&themeId=${themeId}${tokenParam}`;
  } catch {
    return null;
  }
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
  const { theme, config, legacyTheme, device, selectNode, setEditorMode, setThemeSettingsCategory, reorderBlocks, publishVersion } = editor;

  const src = theme ? resolvePreviewUrl(shop, theme.id) : null;
  const previewOrigin = useMemo(() => {
    if (!src) return null;
    try {
      return new URL(src).origin;
    } catch {
      return null;
    }
  }, [src]);

  useEffect(() => {
    if (!config || !previewOrigin) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
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
    if (!previewOrigin || !config) return;
    const currentConfig = config;
    function handleMessage(event: MessageEvent) {
      if (event.origin !== previewOrigin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "theme-section-selected" && typeof data.sectionId === "string") {
        selectNode(data.sectionId);
        return;
      }
      if (data.type === "element-selected" && typeof data.elementId === "string") {
        if (data.elementId === PRODUCT_CARDS_SENTINEL_ID) {
          setEditorMode("theme_settings");
          setThemeSettingsCategory("Product cards");
          return;
        }
        selectNode(data.elementId);
        return;
      }
      if (data.type === "element-deselected") {
        selectNode(null);
        return;
      }
      if (
        data.type === "element-moved" &&
        typeof data.sectionId === "string" &&
        Array.isArray(data.orderedIds) &&
        data.orderedIds.every((id: unknown) => typeof id === "string")
      ) {
        const container: BlockContainerRef =
          data.sectionId === HEADER_CHROME_ID
            ? { kind: "header" }
            : data.sectionId === FOOTER_CHROME_ID
              ? { kind: "footer" }
              : {
                  kind: "section",
                  sectionId: data.sectionId,
                  sectionType: currentConfig.sections.find((s) => s.id === data.sectionId)?.type ?? "hero",
                };
        reorderBlocks(container, null, data.orderedIds as string[]);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [previewOrigin, config, selectNode, setEditorMode, setThemeSettingsCategory, reorderBlocks]);

  if (!theme) return null;

  return (
    <div className="flex h-full flex-col bg-zinc-100 dark:bg-zinc-950">
      <div className="flex flex-1 items-start justify-center overflow-auto p-4">
        {src ? (
          <iframe
            ref={iframeRef}
            key={`${theme.id}-${publishVersion}`}
            title="Storefront preview"
            src={src}
            style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }}
            className="h-full min-h-[600px] rounded-lg border border-black/10 bg-white shadow-sm dark:border-white/10"
          />
        ) : (
          <div className="flex h-full min-h-[600px] w-full max-w-2xl flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-black/15 bg-white text-center dark:border-white/15 dark:bg-zinc-900">
            <p className="text-sm font-medium">Preview unavailable</p>
            <p className="max-w-sm text-xs text-zinc-500">
              This store&apos;s storefront address could not be resolved. Check the storefront URL configuration for this environment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
