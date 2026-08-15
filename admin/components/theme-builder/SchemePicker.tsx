"use client";

import { Plus } from "lucide-react";
import type { ColorScheme } from "@/lib/types";

// Swatch-grid picker for any schemeId-referencing field (Badges' sale/
// sold-out schemes, Drawers, Popovers, a section's own scheme override) —
// Dawn's real color_scheme_group model, deliberately borrowed into this
// otherwise-Horizon settings list per the plan's scope decision. Each card
// shows an "Aa" sample on the scheme's background/text plus a small button-
// color pill; "Edit scheme" jumps the caller to the Colors category (via
// onEditScheme) rather than editing scheme fields inline here.
export default function SchemePicker({
  schemes,
  value,
  onChange,
  onAddScheme,
  onEditScheme,
}: {
  schemes: ColorScheme[];
  value: string | undefined;
  onChange: (id: string) => void;
  onAddScheme: () => string;
  onEditScheme: (id: string) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {schemes.map((scheme) => (
          <button
            key={scheme.id}
            type="button"
            onClick={() => onChange(scheme.id)}
            title={scheme.name}
            className={`flex h-12 flex-col items-center justify-center gap-1 rounded-lg border-2 ${
              value === scheme.id ? "border-accent" : "border-black/10 dark:border-white/10"
            }`}
            style={{ background: scheme.background, color: scheme.text }}
          >
            <span className="text-xs font-semibold">Aa</span>
            <span className="size-2 rounded-full" style={{ background: scheme.button }} />
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(onAddScheme())}
          aria-label="Add scheme"
          className="flex h-12 items-center justify-center rounded-lg border border-dashed border-black/15 text-zinc-400 hover:border-black/30 hover:text-zinc-700 dark:border-white/15 dark:hover:border-white/30 dark:hover:text-zinc-300"
        >
          <Plus className="size-4" />
        </button>
      </div>
      {value && (
        <button type="button" onClick={() => onEditScheme(value)} className="mt-2 text-xs font-medium text-accent hover:underline">
          Edit scheme
        </button>
      )}
    </div>
  );
}
