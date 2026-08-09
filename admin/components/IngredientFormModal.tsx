"use client";

import { useState, type FormEvent } from "react";
import { createIngredient, resolveImageUrl, updateIngredient, uploadIngredientImage } from "@/lib/api";
import type { Ingredient, IngredientCategory } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import ImageDropzone from "@/components/ui/ImageDropzone";
import Modal from "@/components/ui/Modal";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

// Closer to ProductForm's level of detail than the original "name + unit
// only" version, but still deliberately lighter — no price/sku/variants/
// SEO/publishing fields exist on this model (see backend schema.prisma's
// comment on `ingredient`). Per-outlet stock quantity is still set via the
// list page's inline adjust/transfer actions, not this form.
export default function IngredientFormModal({
  ingredient,
  collections,
  onClose,
  onSaved,
}: {
  ingredient: Ingredient | null;
  collections: IngredientCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(ingredient?.name ?? "");
  const [unit, setUnit] = useState(ingredient?.unit ?? "");
  const [description, setDescription] = useState(ingredient?.description ?? "");
  const [costPerUnit, setCostPerUnit] = useState(ingredient?.costPerUnit ?? "");
  const [supplier, setSupplier] = useState(ingredient?.supplier ?? "");
  const [collectionId, setCollectionId] = useState(ingredient?.collectionId ? String(ingredient.collectionId) : "");
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
        collectionId: collectionId === "" ? null : Number(collectionId),
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
    <Modal onClose={onClose} size="sm" title={ingredient ? "Edit ingredient" : "New ingredient"}>
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
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

          <Combobox
            label="Collection"
            value={collectionId}
            onChange={setCollectionId}
            placeholder="— None —"
            options={[
              { value: "", label: "— None —" },
              ...collections.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />

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

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-white dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {saving ? "Saving…" : ingredient ? "Save changes" : "Add ingredient"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
