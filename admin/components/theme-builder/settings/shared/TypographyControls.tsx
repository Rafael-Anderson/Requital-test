"use client";

import Input from "@/components/ui/Input";
import ColorPicker from "@/components/ui/ColorPicker";
import Select from "@/components/ui/Select";

export interface TypographyValue {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: "normal" | "medium" | "semibold" | "bold";
  color?: string;
  letterSpacing?: number;
}

const WEIGHTS: NonNullable<TypographyValue["fontWeight"]>[] = [
  "normal",
  "medium",
  "semibold",
  "bold",
];

// Font family is a plain text field here — the real Google Fonts picker
// (FontPicker.tsx) is a Phase 5 addition; this control's props don't change
// when that lands, only the input it renders for fontFamily.
export default function TypographyControls({
  value,
  onChange,
}: {
  value: TypographyValue | undefined;
  onChange: (next: TypographyValue) => void;
}) {
  const v = value ?? {};
  return (
    <div className="space-y-3">
      <Input
        label="Font family"
        value={v.fontFamily ?? ""}
        onChange={(e) => onChange({ ...v, fontFamily: e.target.value })}
        placeholder="Inter"
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Size (px)"
          type="number"
          value={v.fontSize ?? ""}
          onChange={(e) =>
            onChange({ ...v, fontSize: e.target.value ? Number(e.target.value) : undefined })
          }
        />
        <Select
          label="Weight"
          value={v.fontWeight ?? "normal"}
          onChange={(e) =>
            onChange({ ...v, fontWeight: e.target.value as TypographyValue["fontWeight"] })
          }
        >
          {WEIGHTS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Color</span>
        <ColorPicker value={v.color ?? "#111111"} onChange={(hex) => onChange({ ...v, color: hex })} />
      </div>
      <Input
        label="Letter spacing (px)"
        type="number"
        value={v.letterSpacing ?? ""}
        onChange={(e) =>
          onChange({ ...v, letterSpacing: e.target.value ? Number(e.target.value) : undefined })
        }
      />
    </div>
  );
}
