"use client";

import { Eye, EyeOff } from "lucide-react";

// The eye toggle on a tree row: open eye = shown on the storefront, slashed eye = hidden. Writes the
// same stored on/off value the old row switches did (section.visible / block.visible / the
// announcement bar's enabled flag).
export default function VisibilityButton({
  visible,
  name,
  onToggle,
  className = "",
}: {
  visible: boolean;
  name: string;
  onToggle: () => void;
  className?: string;
}) {
  const Icon = visible ? Eye : EyeOff;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={visible ? `Hide ${name}` : `Show ${name}`}
      aria-pressed={!visible}
      title={visible ? "Hide" : "Show"}
      className={`flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10 ${
        visible ? "text-text-faint" : "text-text-muted"
      } ${className}`}
    >
      <Icon className="size-4" />
    </button>
  );
}
