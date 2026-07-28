"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  createCategory,
  resolveImageUrl,
  updateCategory,
  uploadCategoryImage,
  type CategoryInput,
} from "@/lib/api";
import {
  buildCategoryTree,
  descendantIds,
  flattenCategoryTree,
  type Category,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { useToast } from "@/components/ui/Toast";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function CategoryFormModal({
  category,
  categories,
  onClose,
  onSaved,
}: {
  category: Category | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!category);
  const [parentCategoryId, setParentCategoryId] = useState(
    category?.parentCategoryId != null ? String(category.parentCategoryId) : "",
  );
  const [displayOrder, setDisplayOrder] = useState(String(category?.displayOrder ?? 0));
  const [isFeatured, setIsFeatured] = useState(category?.isFeatured ?? false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(
    resolveImageUrl(category?.image),
  );
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function handleFileSelected(file: File) {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  // Exclude self and all descendants from the parent dropdown so a
  // reassignment can never create a cycle client-side (backend re-checks).
  const excluded = category ? new Set([category.id, ...descendantIds(category.id, categories)]) : new Set<number>();
  const parentOptions = flattenCategoryTree(
    buildCategoryTree(categories.filter((c) => !excluded.has(c.id))),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setSaving(true);
    try {
      const order = Number(displayOrder) || 0;
      let image: string | undefined;
      if (imageFile) {
        const uploaded = await uploadCategoryImage(imageFile);
        image = uploaded.url;
      }

      if (category) {
        const payload: Partial<CategoryInput> = {
          name,
          slug,
          displayOrder: order,
          isFeatured,
          parentCategoryId: parentCategoryId === "" ? null : Number(parentCategoryId),
          ...(image !== undefined && { image }),
        };
        await updateCategory(category.id, payload);
        toast(`"${name}" updated`);
      } else {
        const payload: CategoryInput = { name, slug, displayOrder: order, isFeatured, image };
        if (parentCategoryId !== "") {
          payload.parentCategoryId = Number(parentCategoryId);
        }
        await createCategory(payload);
        toast(`"${name}" created`);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
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
          {category ? `Edit "${category.name}"` : "New category"}
        </h2>

        <div className="space-y-3.5">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />

          <Input
            label="Slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            required
          />

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
              Parent category
            </label>
            <select
              value={parentCategoryId}
              onChange={(e) => setParentCategoryId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
            >
              <option value="">— None (top level) —</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {"— ".repeat(c.depth)}
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Display order"
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />

          <ImageDropzone preview={imagePreview} onFileSelected={handleFileSelected} />

          <div className="flex items-center gap-2">
            <Toggle checked={isFeatured} onChange={setIsFeatured} />
            <span className="text-sm">Featured on homepage</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {category ? "Save changes" : "Create category"}
          </Button>
        </div>
      </form>
    </div>
  );
}
