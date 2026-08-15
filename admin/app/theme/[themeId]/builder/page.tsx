"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useThemeEditor } from "@/lib/useThemeEditor";
import { getShop } from "@/lib/api";
import PageLoader from "@/components/ui/PageLoader";
import BuilderTopBar from "@/components/theme-builder/BuilderTopBar";
import ModeSwitcher from "@/components/theme-builder/ModeSwitcher";
import SectionTree from "@/components/theme-builder/SectionTree";
import PreviewFrame from "@/components/theme-builder/PreviewFrame";
import SettingsPanel from "@/components/theme-builder/SettingsPanel";

// Full-viewport three-panel editor — reached via AppChrome.tsx's
// FULL_BLEED_PATTERN, which skips TopBar/banners/the standard p-6 <main>
// padding for this exact route shape.
export default function ThemeBuilderPage() {
  const params = useParams<{ themeId: string }>();
  const themeId = Number(params.themeId);
  const editor = useThemeEditor(themeId);
  const [shopSlug, setShopSlug] = useState<string | null>(null);

  useEffect(() => {
    getShop()
      .then((shop) => setShopSlug(shop.subdomain))
      .catch(() => {});
  }, []);

  if (editor.loading || !editor.config || !shopSlug) {
    return <PageLoader />;
  }

  return (
    <div className="flex h-screen flex-col">
      <BuilderTopBar editor={editor} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-black/10 dark:border-white/10">
          <ModeSwitcher mode={editor.editorMode} onChange={editor.setEditorMode} />
          {editor.editorMode === "sections" ? (
            <div className="flex-1 overflow-y-auto">
              <SectionTree editor={editor} />
            </div>
          ) : (
            <div className="flex-1" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <PreviewFrame editor={editor} shopSlug={shopSlug} />
        </div>
        <div className="w-80 shrink-0 overflow-y-auto border-l border-black/10 dark:border-white/10">
          <SettingsPanel editor={editor} />
        </div>
      </div>
    </div>
  );
}
