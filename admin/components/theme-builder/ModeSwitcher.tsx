"use client";

import { Layers, Settings, SlidersHorizontal } from "lucide-react";
import type { EditorMode } from "@/lib/useThemeEditor";

const MODES: { key: EditorMode; label: string; Icon: typeof Layers }[] = [
  { key: "sections", label: "Sections", Icon: Layers },
  { key: "theme_settings", label: "Theme settings", Icon: Settings },
  { key: "layout", label: "Layout", Icon: SlidersHorizontal },
];

// The 3-icon row above the section tree — dispatches what the left/right
// panels show (SettingsPanel.tsx reads editorMode first, before any
// node-selection dispatch). App embeds was dropped: this app has no
// app-extensibility model to list real embeds for, and a permanently-empty
// placeholder mode wasn't worth the dead click. Layout replaces it — a
// full port of the old Theme Customizer's Advanced tab (homepage/top bar/
// PDP/cart/checkout layout, header/footer size, icon style, button shape/
// fill, home tab mode, menu) into this builder's own left-list/right-detail
// pattern, backed by the same legacy `themesettings` row via useLegacyTheme.
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
