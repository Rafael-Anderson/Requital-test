"use client";

export default function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    // Bug 4 fix: this used to be a rigid `inline-flex` with no wrap and no
    // width cap - fine at a comfortable panel width, but with no fallback
    // once the row's own preferred width (sum of every button, "Custom
    // URL" being the long one) exceeds whatever narrower container it's
    // rendered in (e.g. MenuBuilder.tsx's mega menu column editor, nested
    // several padded/indented levels deep). flex-wrap lets a squeezed row
    // wrap to a second line instead of pushing content past the card's
    // right edge; the tighter button padding buys a bit more headroom
    // before that wrap is ever needed.
    <div className="flex flex-wrap rounded-lg border border-black/15 dark:border-white/15 p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 rounded-md text-sm font-medium transition-colors cursor-pointer ${
            value === opt.value
              ? "bg-accent text-white"
              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
