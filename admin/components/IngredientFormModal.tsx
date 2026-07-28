"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { createIngredient, updateIngredient } from "@/lib/api";
import type { Ingredient } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

// Much lighter than ProductForm — no price/sku/media/variants/SEO/
// publishing fields exist on this model at all (see backend schema.prisma's
// comment on `ingredient`). Per-outlet stock quantity is set the same way
// Products' own quantity is — the inline reason-coded adjust row on the
// list page — not baked into this create/edit form.
export default function IngredientFormModal({
  ingredient,
  onClose,
  onSaved,
}: {
  ingredient: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(ingredient?.name ?? "");
  const [unit, setUnit] = useState(ingredient?.unit ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !unit.trim()) return;
    setSaving(true);
    try {
      if (ingredient) {
        await updateIngredient(ingredient.id, { name: name.trim(), unit: unit.trim() });
        toast(`"${name.trim()}" updated`);
      } else {
        await createIngredient({ name: name.trim(), unit: unit.trim() });
        toast(`"${name.trim()}" added`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save ingredient", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <h2 className="text-lg font-semibold mb-4">{ingredient ? "Edit ingredient" : "New ingredient"}</h2>

        <div className="space-y-3.5">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <Input
            label="Unit"
            placeholder="e.g. stems, grams, pieces"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            required
          />
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : ingredient ? "Save changes" : "Add ingredient"}
          </Button>
        </div>
      </form>
    </div>
  );
}
