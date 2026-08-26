"use client";

// Replaces the native <select> — a grid of selectable chips, same visual
// pattern as the PDP's variant-option chips. "No preference" becomes a chip
// of its own instead of a default <option value="">.
export default function TimeSlotPicker({
  slots,
  value,
  onChange,
}: {
  slots: string[];
  value: string;
  onChange: (slot: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      <button
        type="button"
        aria-pressed={value === ""}
        onClick={() => onChange("")}
        className={`h-10 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${
          value === "" ? "border-accent bg-accent/10 text-accent" : "border-stroke text-foreground hover:border-black/30"
        }`}
      >
        No preference
      </button>
      {slots.map((s) => {
        const selected = value === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(s)}
            className={`h-10 rounded-lg border text-sm font-medium cursor-pointer transition-colors px-1 ${
              selected ? "border-accent bg-accent/10 text-accent" : "border-stroke text-foreground hover:border-black/30"
            }`}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}
