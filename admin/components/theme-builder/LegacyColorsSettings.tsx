"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import ColorPicker from "@/components/ui/ColorPicker";
import { useLegacyTheme } from "@/lib/useLegacyTheme";
import { THEME_COLOR_DEFAULTS, THEME_COLOR_FIELDS, THEME_COLOR_GROUPS } from "@/lib/types";

// Straight port of the old Theme Customizer's Appearance Color tab
// (app/theme/edit/appearance-color/page.tsx) — the 21 classic-storefront
// color fields plus primary/secondary brand color, none of which the new
// multi-scheme model above replaces (a shop still on the classic/legacy
// rendering path, i.e. one that's never published a new-system theme,
// reads these directly — see shop-context.tsx's resolveThemeCssVars).
// Own Save button, separate from the scheme editor above and from the rest
// of this builder's autosave — matches the old page's own save cycle
// exactly, since this writes a different backend row (themesettings, not
// theme.config).
export default function LegacyColorsSettings() {
  const { theme, saving, save } = useLegacyTheme();
  const [colors, setColors] = useState<Record<string, string>>({});
  const [brandColor, setBrandColor] = useState("#069494");
  const [secondaryColor, setSecondaryColor] = useState("");

  useEffect(() => {
    if (!theme) return;
    setColors(theme.colors ?? {});
    setBrandColor(theme.brandColor ?? "#069494");
    setSecondaryColor(theme.secondaryColor ?? "");
  }, [theme]);

  function setColor(key: string, value: string) {
    setColors((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    const validKeys = new Set(THEME_COLOR_FIELDS.map((f) => f.key));
    const validColors = Object.fromEntries(Object.entries(colors).filter(([key]) => validKeys.has(key)));
    await save({ colors: validColors, brandColor, secondaryColor: secondaryColor || undefined });
  }

  if (!theme) return null;

  return (
    <details className="rounded-lg border border-black/10 dark:border-white/10">
      <summary className="cursor-pointer p-3 text-sm font-medium">Classic storefront colors</summary>
      <div className="space-y-4 border-t border-black/10 p-3 dark:border-white/10">
        <p className="text-xs text-zinc-500">
          Only applies to a shop still on the classic storefront look (no new-system theme published yet).
        </p>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm">Primary color</p>
            <p className="text-xs text-zinc-400">Drives buttons/accents everywhere below that isn&apos;t overridden.</p>
          </div>
          <ColorPicker value={brandColor} onChange={setBrandColor} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm">Secondary color</p>
            <p className="text-xs text-zinc-400">Optional. Derived from primary if unset.</p>
          </div>
          <ColorPicker value={secondaryColor || brandColor} onChange={setSecondaryColor} />
        </div>

        {THEME_COLOR_GROUPS.map((group) => (
          <div key={group.key}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{group.label}</p>
            <div className="divide-y divide-black/5 dark:divide-white/5">
              {THEME_COLOR_FIELDS.filter((f) => f.group === group.key).map((field) => (
                <div key={field.key} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm truncate">{field.label}</span>
                  <ColorPicker value={colors[field.key] ?? THEME_COLOR_DEFAULTS[field.key]} onChange={(hex) => setColor(field.key, hex)} />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end">
          <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave()}>
            Save
          </Button>
        </div>
      </div>
    </details>
  );
}
