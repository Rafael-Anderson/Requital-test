"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useThemeEditor } from "@/lib/useThemeEditor";
import { getShop } from "@/lib/api";
import type { Shop } from "@/lib/types";
import PageLoader from "@/components/ui/PageLoader";
import BuilderTopBar from "@/components/theme-builder/BuilderTopBar";
import ModeSwitcher from "@/components/theme-builder/ModeSwitcher";
import SectionTree from "@/components/theme-builder/SectionTree";
import ThemeSettingsList from "@/components/theme-builder/ThemeSettingsList";
import LayoutList from "@/components/theme-builder/LayoutList";
import PreviewFrame from "@/components/theme-builder/PreviewFrame";
import SettingsPanel from "@/components/theme-builder/SettingsPanel";

// Full-viewport three-panel editor — reached via AppChrome.tsx's
// FULL_BLEED_PATTERN, which skips TopBar/banners/the standard p-6 <main>
// padding for this exact route shape.
export default function ThemeBuilderPage() {
  const params = useParams<{ themeId: string }>();
  const themeId = Number(params.themeId);
  const editor = useThemeEditor(themeId);
  // Full Shop, not just its subdomain — PreviewFrame needs domainType/
  // customDomain too, to build the real per-shop preview address (see its
  // own comment).
  const [shop, setShop] = useState<Shop | null>(null);

  useEffect(() => {
    getShop()
      .then(setShop)
      .catch(() => {});
  }, []);

  if (editor.loading || !editor.config || !shop) {
    return <PageLoader />;
  }

  return (
    <div className="flex h-screen flex-col">
      <BuilderTopBar editor={editor} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-black/10 dark:border-white/10">
          <ModeSwitcher mode={editor.editorMode} onChange={editor.setEditorMode} />
          <div className="flex-1 overflow-y-auto">
            {editor.editorMode === "sections" && <SectionTree editor={editor} />}
            {editor.editorMode === "theme_settings" && <ThemeSettingsList editor={editor} />}
            {editor.editorMode === "layout" && <LayoutList editor={editor} />}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <PreviewFrame editor={editor} shop={shop} />
        </div>
        <div className="w-80 shrink-0 overflow-y-auto border-l border-black/10 dark:border-white/10">
          <SettingsPanel editor={editor} />
        </div>
      </div>
    </div>
  );
}
