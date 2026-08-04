"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import Card from "@/components/ui/Card";

// Shared chrome for a per-product opt-in feature section (Variants,
// Attributes, FAQs) — enabled/disabled is per-product state (see
// product.showVariants/showAttributes/showFaqs), persisted with the product.
// defaultOpen only controls the <details> accordion's initial expand state
// (advanced mode starts every section collapsed; simple mode starts a
// section open the moment the merchant opts in, since that click is itself
// the "I want this now" signal) — it's read once on mount, not kept in sync
// on every render, so a user's own expand/collapse click always sticks.
export default function ProductFeatureSection({
  title,
  addLabel,
  enabled,
  defaultOpen,
  onEnable,
  onDisable,
  children,
}: {
  title: string;
  addLabel: string;
  enabled: boolean;
  defaultOpen: boolean;
  onEnable: () => void;
  onDisable: () => void;
  children: ReactNode;
}) {
  if (!enabled) {
    return (
      <Card>
        <button
          type="button"
          onClick={onEnable}
          className="flex items-center gap-1.5 text-sm text-accent-text hover:underline cursor-pointer"
        >
          <Plus className="size-4" /> {addLabel}
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <details open={defaultOpen}>
        <summary className="text-sm font-semibold cursor-pointer select-none">{title}</summary>
        <div className="mt-4 space-y-4">
          {children}
          <button
            type="button"
            onClick={onDisable}
            className="text-xs text-zinc-400 hover:text-red-600 cursor-pointer"
          >
            Remove {title.toLowerCase()}
          </button>
        </div>
      </details>
    </Card>
  );
}
