"use client";

const ZONES = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center-center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

// Hero's "content position" control — a plain 3x3 button grid, native CSS
// (flex/grid justify-content+align-items mapping on the storefront side),
// no library needed.
export default function NineZoneGridPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (zone: string) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
        Content position
      </span>
      <div className="grid w-24 grid-cols-3 gap-1">
        {ZONES.map((zone) => (
          <button
            key={zone}
            type="button"
            aria-label={zone}
            aria-pressed={value === zone}
            onClick={() => onChange(zone)}
            className={`size-7 cursor-pointer rounded border transition-colors ${
              value === zone
                ? "border-accent bg-accent"
                : "border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
