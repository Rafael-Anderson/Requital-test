"use client";

import ColorPicker from "@/components/ui/ColorPicker";
import Input from "@/components/ui/Input";
import PresetPicker from "@/components/PresetPicker";
import type { GlobalThemeSettings } from "@/lib/types";

const RADIUS_OPTIONS: { key: NonNullable<GlobalThemeSettings["borderRadius"]>; label: string }[] = [
  { key: "sharp", label: "Sharp" },
  { key: "soft", label: "Soft" },
  { key: "round", label: "Round" },
];
const RADIUS_PX: Record<string, string> = { sharp: "0px", soft: "8px", round: "9999px" };

const BUTTON_STYLE_OPTIONS: {
  key: NonNullable<GlobalThemeSettings["buttonStyle"]>;
  label: string;
}[] = [
  { key: "filled", label: "Filled" },
  { key: "outline", label: "Outline" },
  { key: "ghost", label: "Ghost" },
];

export default function GlobalSettingsPanel({
  settings,
  onUpdate,
}: {
  settings: GlobalThemeSettings;
  onUpdate: <K extends keyof GlobalThemeSettings>(key: K, value: GlobalThemeSettings[K]) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold">Colors</h3>
        <div className="space-y-3">
          {(
            [
              ["primaryColor", "Primary"],
              ["secondaryColor", "Secondary"],
              ["accentColor", "Accent"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
              <ColorPicker value={settings[key] ?? "#069494"} onChange={(hex) => onUpdate(key, hex)} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">Fonts</h3>
        {/* Plain text fields for Phase 2 — the real Google Fonts picker
            (FontPicker.tsx) is a Phase 5 addition; swaps in here without
            changing this panel's own contract. */}
        <div className="space-y-3">
          <Input
            label="Body font"
            value={settings.bodyFont ?? ""}
            onChange={(e) => onUpdate("bodyFont", e.target.value)}
            placeholder="Inter"
          />
          <Input
            label="Heading font"
            value={settings.headingFont ?? ""}
            onChange={(e) => onUpdate("headingFont", e.target.value)}
            placeholder="Inter"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">Border radius</h3>
        <PresetPicker
          options={RADIUS_OPTIONS}
          value={settings.borderRadius ?? "soft"}
          onChange={(key) => onUpdate("borderRadius", key)}
          renderThumbnail={(key) => (
            <div
              className="h-10 w-full bg-accent/20"
              style={{ borderRadius: RADIUS_PX[key] }}
            />
          )}
        />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">Button style</h3>
        <PresetPicker
          options={BUTTON_STYLE_OPTIONS}
          value={settings.buttonStyle ?? "filled"}
          onChange={(key) => onUpdate("buttonStyle", key)}
          renderThumbnail={(key) => (
            <div
              className={`flex h-10 w-full items-center justify-center rounded-lg text-xs font-medium ${
                key === "filled"
                  ? "bg-accent text-white"
                  : key === "outline"
                    ? "border border-accent text-accent-text dark:text-accent"
                    : "text-accent-text dark:text-accent"
              }`}
            >
              Button
            </div>
          )}
        />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">Layout</h3>
        <Input
          label="Page max-width (px)"
          type="number"
          value={settings.maxWidth ?? ""}
          onChange={(e) => onUpdate("maxWidth", e.target.value ? Number(e.target.value) : undefined)}
        />
      </div>
    </div>
  );
}
