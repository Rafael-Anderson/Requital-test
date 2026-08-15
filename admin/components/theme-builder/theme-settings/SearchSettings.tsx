"use client";

import { useEffect, useState } from "react";
import Select from "@/components/ui/Select";
import Combobox from "@/components/ui/Combobox";
import Slider from "@/components/ui/Slider";
import { listCollections } from "@/lib/api";
import type { Collection } from "@/lib/types";
import type { SearchSettings as SearchSettingsType, TextCase } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

export default function SearchSettings({ editor }: { editor: ThemeEditorState }) {
  const search = editor.config!.globalSettings.search;
  const [collections, setCollections] = useState<Collection[]>([]);
  function update(patch: Partial<SearchSettingsType>) {
    editor.updateGlobalSettingsCategory("search", patch);
  }

  useEffect(() => {
    listCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Empty state collection</span>
        <Combobox
          value={search.emptyStateCollectionId != null ? String(search.emptyStateCollectionId) : ""}
          onChange={(v) => update({ emptyStateCollectionId: v ? Number(v) : undefined })}
          options={collections.map((c) => ({ value: String(c.id), label: c.name }))}
          placeholder="None"
          searchPlaceholder="Search collections…"
        />
      </div>
      <Slider label="Product image corner radius" min={0} max={40} suffix="px" value={search.productCornerRadius} onChange={(v) => update({ productCornerRadius: v })} />
      <Slider label="Search popover corner radius" min={0} max={40} suffix="px" value={search.cardCornerRadius} onChange={(v) => update({ cardCornerRadius: v })} />
      <Select label="Title case" value={search.titleCase} onChange={(e) => update({ titleCase: e.target.value as TextCase })}>
        <option value="default">Default</option>
        <option value="uppercase">Uppercase</option>
      </Select>
    </div>
  );
}
