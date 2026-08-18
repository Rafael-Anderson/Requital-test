"use client";

import { useState } from "react";
import { Eye, EyeOff, GripVertical, Plus, Trash2 } from "lucide-react";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Tooltip from "@/components/ui/Tooltip";
import RichTextBlockEditor from "@/components/theme-builder/RichTextBlockEditor";
import type { ProductAdditionalInfoBlock } from "@/lib/types";

// Product page "Additional information" accordion blocks (storefront-v2
// Phase 3D) — always available, not gated behind a per-product enable/
// disable toggle the way Variants/Attributes/FAQs are (ProductFeatureSection):
// an empty block list already renders nothing on the storefront, so there's
// no separate "on/off" state worth persisting. Reorder is native HTML5
// drag-and-drop, matching Collections/MenuBuilder/BioLinks — the actual
// pattern used everywhere in admin outside the theme builder (dnd-kit is a
// Sections-mode-only dependency there, not a general admin convention).
export default function AdditionalInfoSection({
  blocks,
  onChange,
}: {
  blocks: ProductAdditionalInfoBlock[];
  onChange: (blocks: ProductAdditionalInfoBlock[]) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  function addBlock() {
    onChange([...blocks, { id: crypto.randomUUID(), title: "", body: "", visible: true }]);
  }

  function updateBlock(id: string, patch: Partial<ProductAdditionalInfoBlock>) {
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function removeBlock(id: string) {
    onChange(blocks.filter((b) => b.id !== id));
  }

  function handleDrop(targetId: string) {
    if (draggedId === null || draggedId === targetId) {
      setDraggedId(null);
      return;
    }
    const fromIndex = blocks.findIndex((b) => b.id === draggedId);
    const toIndex = blocks.findIndex((b) => b.id === targetId);
    const reordered = [...blocks];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    onChange(reordered);
    setDraggedId(null);
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Additional information</h3>
        <button
          type="button"
          onClick={addBlock}
          className="flex items-center gap-1.5 text-sm text-accent-text hover:underline cursor-pointer"
        >
          <Plus className="size-4" /> Add block
        </button>
      </div>
      <p className="mt-1 text-xs text-text-faint">
        Expandable accordions shown below the description on the product page (e.g. Delivery Instructions, Care Instructions).
      </p>

      {blocks.length > 0 && (
        <div className="mt-4 space-y-3">
          {blocks.map((block) => (
            <div
              key={block.id}
              draggable
              onDragStart={() => setDraggedId(block.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(block.id)}
              className={`rounded-lg border border-border dark:border-white/10 p-3 space-y-2.5 ${draggedId === block.id ? "opacity-40" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="cursor-grab active:cursor-grabbing text-text-faint shrink-0" aria-hidden>
                  <GripVertical className="size-4" />
                </span>
                <Input
                  label="Title"
                  value={block.title}
                  onChange={(e) => updateBlock(block.id, { title: e.target.value })}
                  className="flex-1"
                />
                <Tooltip label={block.visible ? "Hide on storefront" : "Show on storefront"}>
                  <button
                    type="button"
                    onClick={() => updateBlock(block.id, { visible: !block.visible })}
                    aria-label={block.visible ? "Hide block" : "Show block"}
                    className="mt-5 p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                  >
                    {block.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </button>
                </Tooltip>
                <Tooltip label="Remove block" align="end">
                  <button
                    type="button"
                    onClick={() => removeBlock(block.id)}
                    aria-label="Remove block"
                    className="mt-5 p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer shrink-0"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </Tooltip>
              </div>
              <RichTextBlockEditor
                blockId={block.id}
                label="Body"
                value={block.body}
                onChange={(html) => updateBlock(block.id, { body: html })}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
