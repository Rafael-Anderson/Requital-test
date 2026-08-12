"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useThemeEditor } from "@/lib/useThemeEditor";
import { getShop } from "@/lib/api";
import PageLoader from "@/components/ui/PageLoader";
import BuilderTopBar from "@/components/theme-builder/BuilderTopBar";
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
        <div className="w-64 shrink-0 overflow-y-auto border-r border-black/10 dark:border-white/10">
          <SectionTree
            sections={editor.config.sections}
            selectedSectionId={editor.selectedSectionId}
            onSelectSection={(id) => {
              editor.setSelectedSectionId(id);
              editor.setSelectedElementId(null);
            }}
            onToggleVisibility={editor.toggleSectionVisibility}
            onReorder={editor.reorderSections}
            onAddSection={editor.addSection}
            onRemoveSection={editor.removeSection}
          />
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
