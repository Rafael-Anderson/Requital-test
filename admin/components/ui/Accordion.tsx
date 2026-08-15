"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface AccordionItem {
  key: string;
  label: string;
  content: ReactNode;
}

// Hand-rolled, no dependency — same "no shadcn theme installed here" reasoning
// as every other primitive in this directory. Externally controlled (open/
// onToggle) rather than owning its own state, so a caller elsewhere in the
// tree (SchemePicker's "Edit scheme" link) can jump straight to a specific
// category from outside the accordion itself.
export default function Accordion({
  items,
  open,
  onToggle,
}: {
  items: AccordionItem[];
  open: string | null;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="divide-y divide-black/10 dark:divide-white/10">
      {items.map((item) => {
        const isOpen = open === item.key;
        return (
          <div key={item.key}>
            <button
              type="button"
              onClick={() => onToggle(item.key)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-2 py-3 text-left text-sm font-medium"
            >
              {item.label}
              <ChevronDown className={`size-4 shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && <div className="pb-4">{item.content}</div>}
          </div>
        );
      })}
    </div>
  );
}
