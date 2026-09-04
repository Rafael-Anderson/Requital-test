"use client";

import FontPicker from "@/components/ui/FontPicker";
import Select from "@/components/ui/Select";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Slider from "@/components/ui/Slider";
import type {
  HeadingTextPreset,
  TextCase,
  TextLetterSpacing,
  TextLineHeight,
  TypeScale,
  TypographyPairing,
  TypographySettings as TypographySettingsType,
} from "@/lib/types";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

const LINE_HEIGHTS: TextLineHeight[] = ["tight", "normal", "loose"];
const LETTER_SPACINGS: TextLetterSpacing[] = ["tight", "normal", "wide"];

// Phase B1 — typography pairing + modular scale + base font size.
const PAIRINGS: { value: string; label: string }[] = [
  { value: "", label: "Custom (use the font pickers below)" },
  { value: "modern-sans", label: "Modern Sans" },
  { value: "editorial-serif", label: "Editorial Serif" },
  { value: "warm-humanist", label: "Warm Humanist" },
  { value: "grotesque", label: "Grotesque" },
  { value: "classic", label: "Classic" },
  { value: "bold-display", label: "Bold Display" },
  { value: "handwritten-accent", label: "Handwritten Accent" },
];
const SCALES: { value: string; label: string }[] = [
  { value: "", label: "Custom (set each heading below)" },
  { value: "compact", label: "Compact" },
  { value: "default", label: "Default" },
  { value: "spacious", label: "Spacious" },
  { value: "dramatic", label: "Dramatic" },
];

function HeadingPresetFields({
  label,
  value,
  sizeDisabled,
  onChange,
}: {
  label: string;
  value: HeadingTextPreset;
  sizeDisabled?: boolean;
  onChange: (patch: Partial<HeadingTextPreset>) => void;
}) {
  return (
    <details className="rounded-lg border border-black/10 p-3 dark:border-white/10">
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <div className="mt-3 space-y-3">
        <SegmentedToggle<HeadingTextPreset["font"]>
          value={value.font}
          options={[
            { value: "heading", label: "Heading font" },
            { value: "accent", label: "Accent font" },
          ]}
          onChange={(v) => onChange({ font: v })}
        />
        <div className={sizeDisabled ? "pointer-events-none opacity-50" : ""}>
          <Slider label="Size" min={10} max={80} suffix="px" value={value.size} onChange={(v) => onChange({ size: v })} />
          {sizeDisabled && <p className="mt-1 text-xs text-zinc-400">Computed from the type scale.</p>}
        </div>
        <Select label="Line height" value={value.lineHeight} onChange={(e) => onChange({ lineHeight: e.target.value as TextLineHeight })}>
          {LINE_HEIGHTS.map((v) => (
            <option key={v} value={v}>
              {v[0].toUpperCase() + v.slice(1)}
            </option>
          ))}
        </Select>
        <Select label="Letter spacing" value={value.letterSpacing} onChange={(e) => onChange({ letterSpacing: e.target.value as TextLetterSpacing })}>
          {LETTER_SPACINGS.map((v) => (
            <option key={v} value={v}>
              {v[0].toUpperCase() + v.slice(1)}
            </option>
          ))}
        </Select>
        <SegmentedToggle<TextCase>
          value={value.case}
          options={[
            { value: "default", label: "Default" },
            { value: "uppercase", label: "Uppercase" },
          ]}
          onChange={(v) => onChange({ case: v })}
        />
      </div>
    </details>
  );
}

const HEADING_KEYS: (keyof Pick<TypographySettingsType, "h1" | "h2" | "h3" | "h4" | "h5" | "h6">)[] = ["h1", "h2", "h3", "h4", "h5", "h6"];

export default function TypographySettings({ editor }: { editor: ThemeEditorState }) {
  const typography = editor.config!.globalSettings.typography;

  function updateHeading(key: (typeof HEADING_KEYS)[number], patch: Partial<HeadingTextPreset>) {
    editor.updateGlobalSettingsCategory("typography", { [key]: { ...typography[key], ...patch } });
  }

  const pairingActive = !!typography.pairing;
  const scaleActive = !!typography.scale;

  return (
    <div className="space-y-4">
      {/* Phase B1 — a pairing bundles the 4 font roles; picking one greys the
          individual pickers (unset = "Custom" restores them). */}
      <Select
        label="Font pairing"
        value={typography.pairing ?? ""}
        onChange={(e) => editor.updateGlobalSettingsCategory("typography", { pairing: (e.target.value || undefined) as TypographyPairing | undefined })}
      >
        {PAIRINGS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>

      <div className={pairingActive ? "pointer-events-none space-y-4 opacity-50" : "space-y-4"}>
        <FontPicker label="Body font" value={typography.bodyFont} onChange={(v) => editor.updateGlobalSettingsCategory("typography", { bodyFont: v })} />
        <FontPicker label="Subheading font" value={typography.subheadingFont} onChange={(v) => editor.updateGlobalSettingsCategory("typography", { subheadingFont: v })} />
        <FontPicker label="Heading font" value={typography.headingFont} onChange={(v) => editor.updateGlobalSettingsCategory("typography", { headingFont: v })} />
        <FontPicker label="Accent font" value={typography.accentFont} onChange={(v) => editor.updateGlobalSettingsCategory("typography", { accentFont: v })} />
      </div>

      <hr className="border-black/10 dark:border-white/10" />

      <Select
        label="Heading scale"
        value={typography.scale ?? ""}
        onChange={(e) => editor.updateGlobalSettingsCategory("typography", { scale: (e.target.value || undefined) as TypeScale | undefined })}
      >
        {SCALES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <Slider
        label="Base font size"
        min={14}
        max={17}
        suffix="px"
        value={typography.baseFontSize ?? typography.paragraph.size}
        onChange={(v) => editor.updateGlobalSettingsCategory("typography", { baseFontSize: v as NonNullable<TypographySettingsType["baseFontSize"]> })}
      />

      <hr className="border-black/10 dark:border-white/10" />

      <details className="rounded-lg border border-black/10 p-3 dark:border-white/10" open>
        <summary className="cursor-pointer text-sm font-medium">Paragraph</summary>
        <div className="mt-3 space-y-3">
          <Slider
            label="Size"
            min={10}
            max={24}
            suffix="px"
            value={typography.paragraph.size}
            onChange={(v) => editor.updateGlobalSettingsCategory("typography", { paragraph: { ...typography.paragraph, size: v } })}
          />
          <Select
            label="Line height"
            value={typography.paragraph.lineHeight}
            onChange={(e) =>
              editor.updateGlobalSettingsCategory("typography", { paragraph: { ...typography.paragraph, lineHeight: e.target.value as TextLineHeight } })
            }
          >
            {LINE_HEIGHTS.map((v) => (
              <option key={v} value={v}>
                {v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
          </Select>
        </div>
      </details>

      {HEADING_KEYS.map((key) => (
        <HeadingPresetFields
          key={key}
          label={key.toUpperCase()}
          value={typography[key]}
          sizeDisabled={scaleActive}
          onChange={(patch) => updateHeading(key, patch)}
        />
      ))}
    </div>
  );
}
