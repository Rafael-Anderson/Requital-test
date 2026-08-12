"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { STOREFRONT_URL } from "@/lib/api";
import type { ThemeEditorState, DevicePreview } from "@/lib/useThemeEditor";

const DEVICE_WIDTH: Record<DevicePreview, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "390px",
};

const STOREFRONT_ORIGIN = new URL(STOREFRONT_URL).origin;
const POST_DEBOUNCE_MS = 250;

// Live preview: every config edit is posted to the iframe (debounced, so a
// fast typing burst doesn't flood postMessage), no save/reload needed to
// see it reflected — per the spec. The iframe itself only remounts on a
// theme-id change or manual "Refresh preview" click, not on every edit or
// autosave. Explicit target origin throughout, never '*'. The reverse
// channel (clicking a section inside the preview selects it here) is the
// same window 'message' listener, discriminated by payload type.
export default function PreviewFrame({
  editor,
  shopSlug,
}: {
  editor: ThemeEditorState;
  shopSlug: string;
}) {
  const [manualRefreshCount, setManualRefreshCount] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { theme, config, device, setSelectedSectionId, setSelectedElementId } = editor;

  useEffect(() => {
    if (!config) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "theme-config-update", config },
        STOREFRONT_ORIGIN,
      );
    }, POST_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [config]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== STOREFRONT_ORIGIN) return;
      if (event.data?.type === "theme-section-selected" && typeof event.data.sectionId === "string") {
        setSelectedSectionId(event.data.sectionId);
        setSelectedElementId(null);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [setSelectedSectionId, setSelectedElementId]);

  if (!theme) return null;

  const src = `${STOREFRONT_URL}/${shopSlug}?preview=true&themeId=${theme.id}`;

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
        <iframe
          ref={iframeRef}
          key={`${theme.id}-${manualRefreshCount}`}
          title="Storefront preview"
          src={src}
          style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }}
          className="h-full min-h-[600px] rounded-lg border border-black/10 bg-white shadow-sm dark:border-white/10"
        />
      </div>
    </div>
  );
}
