"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useThemeEditor } from "@/lib/useThemeEditor";
import { getShop } from "@/lib/api";
import type { Shop } from "@/lib/types";
import PageLoader from "@/components/ui/PageLoader";
import BuilderTopBar from "@/components/theme-builder/BuilderTopBar";
import BuilderPanel from "@/components/theme-builder/BuilderPanel";
import PreviewFrame, { PreviewPageSelector } from "@/components/theme-builder/PreviewFrame";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import type { DevicePreview } from "@/lib/useThemeEditor";

// The panel is a fixed column from 1024px up and a slide-over drawer below it.
const WIDE_QUERY = "(min-width: 1024px)";

// Full-viewport editor, reached via AppChrome.tsx's FULL_BLEED_PATTERN (no admin chrome around it):
// a top bar, ONE 320px left panel (Sections / Design / Settings, with drill-in) and the preview,
// which takes all the remaining width.
export default function ThemeBuilderPage() {
  const params = useParams<{ themeId: string }>();
  const themeId = Number(params.themeId);
  const editor = useThemeEditor(themeId);
  // Full Shop, not just its subdomain: PreviewFrame needs domainType/customDomain too, to build the
  // real per-shop preview address (see its own comment).
  const [shop, setShop] = useState<Shop | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    getShop()
      .then(setShop)
      .catch(() => {});
  }, []);

  // On a narrow screen, selecting something (in the preview, or by a deep link) opens the drawer on
  // its settings. Adjusted during render when the selection changes (React's "store information from
  // previous renders" pattern), not in an effect.
  const { selectedId } = editor;
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(selectedId);
  if (selectedId !== lastSelectedId) {
    setLastSelectedId(selectedId);
    if (selectedId && typeof window !== "undefined" && typeof window.matchMedia === "function" && !window.matchMedia(WIDE_QUERY).matches) {
      setDrawerOpen(true);
    }
  }

  if (editor.loading || !editor.config || !shop) {
    return <PageLoader />;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page">
      <BuilderTopBar
        editor={editor}
        shopName={shop.displayName?.trim() || shop.name}
        panelOpen={drawerOpen}
        onTogglePanel={() => setDrawerOpen((v) => !v)}
      />
      {/* Below 768px the page selector and device toggle do not fit in the bar: their own row. */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-2 py-1.5 dark:border-white/10 dark:bg-zinc-900 md:hidden">
        <PreviewPageSelector previewPath={editor.previewPath} setPreviewPath={editor.setPreviewPath} />
        <SegmentedToggle<DevicePreview>
          value={editor.device}
          options={[
            { value: "desktop", label: "Desktop" },
            { value: "tablet", label: "Tablet" },
            { value: "mobile", label: "Mobile" },
          ]}
          onChange={editor.setDevice}
        />
      </div>
      <div className="relative flex min-h-0 flex-1">
        {drawerOpen && (
          <div aria-hidden className="absolute inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setDrawerOpen(false)} />
        )}
        <aside
          aria-label="Theme builder panel"
          data-testid="builder-panel"
          className={`absolute inset-y-0 start-0 z-40 w-[min(320px,88vw)] border-e border-border shadow-xl transition-transform dark:border-white/10 lg:static lg:z-auto lg:w-[320px] lg:shrink-0 lg:shadow-none ${
            drawerOpen ? "" : "max-lg:invisible max-lg:-translate-x-full max-lg:rtl:translate-x-full"
          }`}
        >
          <BuilderPanel editor={editor} />
        </aside>
        <main className="min-w-0 flex-1">
          <PreviewFrame editor={editor} shop={shop} />
        </main>
      </div>
    </div>
  );
}
