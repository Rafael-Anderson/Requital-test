"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { STOREFRONT_URL } from "@/lib/api";
import type { ThemeEditorState, DevicePreview } from "@/lib/useThemeEditor";

const DEVICE_WIDTH: Record<DevicePreview, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "390px",
};

// Phase 2: no postMessage yet (that's Phase 4) — the preview only reflects
// the last *saved* draft. Reloads automatically whenever a save completes
// (keyed on theme.updatedAt, which changes on every successful PATCH) and
// on manual "Refresh preview" click.
export default function PreviewFrame({
  editor,
  shopSlug,
}: {
  editor: ThemeEditorState;
  shopSlug: string;
}) {
  const [manualRefreshCount, setManualRefreshCount] = useState(0);
  const { theme, device } = editor;

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
          key={`${theme.id}-${theme.updatedAt}-${manualRefreshCount}`}
          title="Storefront preview"
          src={src}
          style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }}
          className="h-full min-h-[600px] rounded-lg border border-black/10 bg-white shadow-sm dark:border-white/10"
        />
      </div>
    </div>
  );
}
