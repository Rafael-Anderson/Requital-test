"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { STOREFRONT_URL, storefrontUrlFor } from "@/lib/api";
import type { Shop } from "@/lib/types";
import type { ThemeEditorState, DevicePreview } from "@/lib/useThemeEditor";

const DEVICE_WIDTH: Record<DevicePreview, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "390px",
};

const POST_DEBOUNCE_MS = 250;

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
function resolvePreviewUrl(shop: Shop, themeId: number): string | null {
  const storefrontHostname = (() => {
    try {
      return new URL(STOREFRONT_URL).hostname;
    } catch {
      return null;
    }
  })();

  if (storefrontHostname && isLocalHost(storefrontHostname)) {
    return `${STOREFRONT_URL}/${shop.subdomain}?preview=true&themeId=${themeId}`;
  }

  try {
    const base = storefrontUrlFor(shop);
    // Defensive: never actually point a "production" preview at a local
    // address — if it somehow resolved to one (e.g. a misconfigured root
    // domain env var), treat it as unresolvable rather than loading a dead
    // iframe silently.
    if (isLocalHost(new URL(base).hostname)) return null;
    return `${base}?preview=true&themeId=${themeId}`;
  } catch {
    return null;
  }
}

// Live preview: every config edit is posted to the iframe (debounced, so a
// fast typing burst doesn't flood postMessage), no save/reload needed to
// see it reflected — per the spec. The iframe itself only remounts on a
// theme-id change or manual "Refresh preview" click, not on every edit or
// autosave. Explicit target origin throughout, never '*'. The reverse
// channel (clicking a section inside the preview selects it here) is the
// same window 'message' listener, discriminated by payload type.
export default function PreviewFrame({
  editor,
  shop,
}: {
  editor: ThemeEditorState;
  shop: Shop;
}) {
  const [manualRefreshCount, setManualRefreshCount] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { theme, config, device, selectNode } = editor;

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

  useEffect(() => {
    if (!previewOrigin) return;
    function handleMessage(event: MessageEvent) {
      if (event.origin !== previewOrigin) return;
      if (event.data?.type === "theme-section-selected" && typeof event.data.sectionId === "string") {
        selectNode(event.data.sectionId);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [previewOrigin, selectNode]);

  if (!theme) return null;

  return (
    <div className="flex h-full flex-col bg-zinc-100 dark:bg-zinc-950">
      <div className="flex items-center justify-end border-b border-black/10 px-3 py-1.5 dark:border-white/10">
        <button
          type="button"
          onClick={() => setManualRefreshCount((n) => n + 1)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <RefreshCw className="size-3.5" />
          Refresh preview
        </button>
      </div>
      <div className="flex flex-1 items-start justify-center overflow-auto p-4">
        {src ? (
          <iframe
            ref={iframeRef}
            key={`${theme.id}-${manualRefreshCount}`}
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
