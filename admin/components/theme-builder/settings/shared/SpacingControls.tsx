"use client";

import Input from "@/components/ui/Input";

export interface SpacingValue {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

const FIELDS: { key: keyof SpacingValue; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
];

export default function SpacingControls({
  value,
  onChange,
}: {
  value: SpacingValue | undefined;
  onChange: (next: SpacingValue) => void;
}) {
  const v = value ?? {};
  return (
    <div>
      <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
        Padding (px)
      </span>
      <div className="mt-1.5 grid grid-cols-2 gap-3">
        {FIELDS.map(({ key, label }) => (
          <Input
            key={key}
            label={label}
            type="number"
            min={0}
            value={v[key] ?? ""}
            onChange={(e) =>
              onChange({ ...v, [key]: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        ))}
      </div>
    </div>
  );
}
