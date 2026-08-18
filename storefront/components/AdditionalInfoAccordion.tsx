"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-html";
import type { ProductAdditionalInfoBlock } from "@/lib/types";

// One row — its own open/close state, a max-height CSS transition (not a
// JS-measured height) per the design brief, capped high enough (2000px)
// that no realistic merchant-authored block ever gets clipped mid-animation.
function AccordionRow({ block, defaultOpen }: { block: ProductAdditionalInfoBlock; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-stroke last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 py-3 text-left cursor-pointer"
      >
        <span className="text-[14px] font-bold text-product-name">{block.title}</span>
        <ChevronDown className={`size-4 shrink-0 text-zinc-500 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: open ? 2000 : 0 }}
      >
        <div
          className="text-[14px] text-zinc-600 leading-relaxed py-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-accent-text [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(block.body) }}
        />
      </div>
    </div>
  );
}

// Product page "Additional information" accordions (storefront-v2 Phase
// 3D) — rendered below the main description, first visible block open by
// default, the rest closed.
export default function AdditionalInfoAccordion({ blocks }: { blocks: ProductAdditionalInfoBlock[] | null }) {
  const visible = (blocks ?? []).filter((b) => b.visible && b.title.trim());
  if (visible.length === 0) return null;
  return (
    <div className="mt-6 pt-6 border-t border-stroke">
      {visible.map((block, i) => (
        <AccordionRow key={block.id} block={block} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
