"use client";

import { useState, type FormEvent } from "react";
import { createIngredientCategory, updateIngredientCategory } from "@/lib/api";
import type { IngredientCategory } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
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
    <Modal onClose={onClose} size="sm" title={category ? "Edit ingredient category" : "New ingredient category"}>
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-white dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {saving ? "Saving…" : category ? "Save changes" : "Add category"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
