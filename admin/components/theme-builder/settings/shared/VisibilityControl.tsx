"use client";

import SegmentedToggle from "@/components/ui/SegmentedToggle";
import type { SectionVisibility } from "@/lib/types";

export default function VisibilityControl({
  value,
  onChange,
}: {
  value: SectionVisibility | undefined;
  onChange: (next: SectionVisibility) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
        Visibility
      </span>
      <SegmentedToggle<SectionVisibility>
        value={value ?? "both"}
        options={[
          { value: "both", label: "Both" },
          { value: "desktop", label: "Desktop only" },
          { value: "mobile", label: "Mobile only" },
        ]}
        onChange={onChange}
      />
    </div>
  );
}
