"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { createIngredientCategory, updateIngredientCategory } from "@/lib/api";
import type { IngredientCategory } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

// Flat — just a name, unlike CategoryFormModal (no slug/parent/image/
// featured toggle — see ingredientcategory's schema comment for why).
export default function IngredientCategoryFormModal({
  category,
  onClose,
  onSaved,
}: {
  category: IngredientCategory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (category) {
        await updateIngredientCategory(category.id, name.trim());
        toast(`"${name.trim()}" updated`);
      } else {
        await createIngredientCategory(name.trim());
        toast(`"${name.trim()}" added`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save category", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
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

        <h2 className="text-lg font-semibold mb-4">
          {category ? "Edit ingredient category" : "New ingredient category"}
        </h2>

        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : category ? "Save changes" : "Add category"}
          </Button>
        </div>
      </form>
    </div>
  );
}
