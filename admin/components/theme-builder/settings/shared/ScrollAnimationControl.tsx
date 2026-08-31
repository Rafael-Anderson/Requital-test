"use client";

import Select from "@/components/ui/Select";
import type { ScrollAnimation } from "@/lib/types";

const OPTIONS: { value: ScrollAnimation; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade-in", label: "Fade in" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-right", label: "Slide right" },
];

export default function ScrollAnimationControl({
  value,
  onChange,
  label = "Scroll animation",
}: {
  value: ScrollAnimation | undefined;
  onChange: (next: ScrollAnimation) => void;
  label?: string;
}) {
  return (
    <Select
      label={label}
      value={value ?? "none"}
      onChange={(e) => onChange(e.target.value as ScrollAnimation)}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
