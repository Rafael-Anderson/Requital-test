"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import ColorPicker from "@/components/ui/ColorPicker";
import LegacyColorsSettings from "../LegacyColorsSettings";
import type { ColorScheme } from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

const COLOR_FIELDS: { key: keyof ColorScheme; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
  { key: "button", label: "Button" },
  { key: "buttonLabel", label: "Button label" },
  { key: "secondaryButtonLabel", label: "Secondary button label" },
];

// Dawn's real multi-scheme color model, deliberately borrowed into this
// otherwise-Horizon settings list (see the plan's scope decision). Every
// other category's schemeId field (Badges, Drawers, Popovers, a section's
// own override) references a scheme by id created/edited here.
export default function ColorsSettings({ editor }: { editor: ThemeEditorState }) {
  const schemes = editor.config!.globalSettings.colorSchemes;
  const [selectedId, setSelectedId] = useState<string | null>(schemes[0]?.id ?? null);
  const selected = schemes.find((s) => s.id === selectedId) ?? schemes[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {schemes.map((scheme) => (
          <button
            key={scheme.id}
            type="button"
            onClick={() => setSelectedId(scheme.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              selected?.id === scheme.id ? "border-accent bg-accent/10" : "border-black/15 dark:border-white/15"
            }`}
            style={{ background: selected?.id === scheme.id ? undefined : scheme.background, color: selected?.id === scheme.id ? undefined : scheme.text }}
          >
            {scheme.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSelectedId(editor.addColorScheme())}
          className="rounded-full border border-dashed border-black/15 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:border-black/30 dark:border-white/15"
        >
          + Add scheme
        </button>
      </div>

      {selected && (
        <div className="space-y-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
          <div className="flex items-end gap-2">
            <Input
              label="Name"
              value={selected.name}
              onChange={(e) => editor.updateColorScheme(selected.id, { name: e.target.value })}
            />
            {schemes.length > 1 && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  editor.removeColorScheme(selected.id);
                  setSelectedId(schemes.find((s) => s.id !== selected.id)?.id ?? null);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
          {COLOR_FIELDS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
              <ColorPicker
                value={(selected[key] as string) ?? "#000000"}
                onChange={(hex) => editor.updateColorScheme(selected.id, { [key]: hex })}
              />
            </div>
          ))}
        </div>
      )}

      <LegacyColorsSettings />
    </div>
  );
}
