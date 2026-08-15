"use client";

import { Blocks, Layers, Settings } from "lucide-react";
import type { EditorMode } from "@/lib/useThemeEditor";

const MODES: { key: EditorMode; label: string; Icon: typeof Layers }[] = [
  { key: "sections", label: "Sections", Icon: Layers },
  { key: "theme_settings", label: "Theme settings", Icon: Settings },
  { key: "app_embeds", label: "App embeds", Icon: Blocks },
];

// The 3-icon row above the section tree, matching Shopify's real editor
// placement — dispatches what the left/right panels show (SettingsPanel.tsx
// reads editorMode first, before any node-selection dispatch).
export default function ModeSwitcher({ mode, onChange }: { mode: EditorMode; onChange: (mode: EditorMode) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-black/10 p-2 dark:border-white/10">
      {MODES.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={label}
          aria-label={label}
          aria-pressed={mode === key}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${
            mode === key
              ? "bg-accent/10 text-accent-text dark:text-accent"
              : "text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          }`}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
