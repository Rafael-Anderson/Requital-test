"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { createIngredient, resolveImageUrl, updateIngredient, uploadIngredientImage } from "@/lib/api";
import type { Ingredient, IngredientCategory } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { useToast } from "@/components/ui/Toast";

// Closer to ProductForm's level of detail than the original "name + unit
// only" version, but still deliberately lighter — no price/sku/variants/
// SEO/publishing fields exist on this model (see backend schema.prisma's
// comment on `ingredient`). Per-outlet stock quantity is still set via the
// list page's inline adjust/transfer actions, not this form.
export default function IngredientFormModal({
  ingredient,
  categories,
  onClose,
  onSaved,
}: {
  ingredient: Ingredient | null;
  categories: IngredientCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(ingredient?.name ?? "");
  const [unit, setUnit] = useState(ingredient?.unit ?? "");
  const [description, setDescription] = useState(ingredient?.description ?? "");
  const [costPerUnit, setCostPerUnit] = useState(ingredient?.costPerUnit ?? "");
  const [supplier, setSupplier] = useState(ingredient?.supplier ?? "");
  const [categoryId, setCategoryId] = useState(ingredient?.categoryId ? String(ingredient.categoryId) : "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(resolveImageUrl(ingredient?.image));
  const [saving, setSaving] = useState(false);

  function handleFileSelected(file: File) {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !unit.trim()) return;
    setSaving(true);
    try {
      let image: string | undefined;
      if (imageFile) {
        const uploaded = await uploadIngredientImage(imageFile);
        image = uploaded.url;
      }
      const payload = {
        name: name.trim(),
        unit: unit.trim(),
        description: description.trim() || null,
        costPerUnit: costPerUnit === "" ? null : Number(costPerUnit),
        supplier: supplier.trim() || null,
        categoryId: categoryId === "" ? null : Number(categoryId),
        ...(image !== undefined && { image }),
      };
      if (ingredient) {
        await updateIngredient(ingredient.id, payload);
        toast(`"${name.trim()}" updated`);
      } else {
        await createIngredient(payload);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative max-h-[90vh] overflow-y-auto modal-scroll"
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
          <ImageDropzone preview={imagePreview} onFileSelected={handleFileSelected} />

          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            <Input
              label="Unit"
              placeholder="e.g. stems, grams"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Cost per unit (optional)"
              type="number"
              min="0"
              step="0.01"
              value={costPerUnit}
              onChange={(e) => setCostPerUnit(e.target.value)}
            />
            <Input
              label="Supplier (optional)"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </div>
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
