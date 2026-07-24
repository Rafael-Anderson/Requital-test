"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createProduct, listCategories, resolveImageUrl, updateProduct, uploadProductImage } from "@/lib/api";
import type { Category, Product } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Checkbox from "@/components/ui/Checkbox";
import ImageDropzone from "@/components/ui/ImageDropzone";
import CategoryCheckboxTree from "@/components/CategoryCheckboxTree";
import { useToast } from "@/components/ui/Toast";

export default function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!product;

  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product?.price ?? "");
  const [trackInventory, setTrackInventory] = useState(product?.trackInventory ?? false);
  const [categoryIds, setCategoryIds] = useState<Set<number>>(
    new Set(product?.categories.map((c) => c.id) ?? []),
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(
    resolveImageUrl(product?.thumbnail),
  );

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load categories"));
  }, []);

  function handleFileSelected(file: File) {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setFieldErrors((f) => ({ ...f, image: "" }));
  }

  function toggleCategory(id: number) {
    setCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextFieldErrors: Record<string, string> = {};
    if (!name.trim()) nextFieldErrors.name = "Name is required";
    if (!sku.trim()) nextFieldErrors.sku = "SKU is required";
    if (!price) nextFieldErrors.price = "Price is required";
    if (!imagePreview) nextFieldErrors.image = "An image is required";
    if (categoryIds.size === 0) nextFieldErrors.categories = "Select at least one category";
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setError(null);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      let thumbnail = product?.thumbnail ?? "";
      if (imageFile) {
        const uploaded = await uploadProductImage(imageFile);
        thumbnail = uploaded.url;
      }

      const payload = {
        name,
        sku,
        description: description || undefined,
        price: Number(price),
        thumbnail,
        trackInventory,
        categoryIds: [...categoryIds],
      };

      if (isEdit) {
        await updateProduct(product.id, payload);
        toast(`"${name}" updated`);
      } else {
        await createProduct(payload);
        toast(`"${name}" created`);
      }
      router.push("/inventory");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save product", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} />
        <Input label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} error={fieldErrors.sku} />
      </div>

      <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />

      <div className="w-40">
        <Input
          label="Price (AED)"
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={fieldErrors.price}
        />
      </div>

      <ImageDropzone preview={imagePreview} onFileSelected={handleFileSelected} error={fieldErrors.image} />

      <div>
        <Checkbox
          label="Track inventory"
          checked={trackInventory}
          onChange={(e) => setTrackInventory(e.target.checked)}
        />
        {trackInventory && (
          <p className="text-xs text-zinc-500 mt-2">
            Stock counts are set per branch on the Inventory page, not here — each outlet tracks
            its own quantity for this product.
          </p>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Categories</label>
        <CategoryCheckboxTree
          categories={categories ?? []}
          selected={categoryIds}
          onToggle={toggleCategory}
        />
        {fieldErrors.categories && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
            {fieldErrors.categories}
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/inventory")}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {isEdit ? "Save changes" : "Create product"}
        </Button>
      </div>
    </form>
  );
}
