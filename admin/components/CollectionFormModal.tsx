"use client";

import { useEffect, useState } from "react";
import {
  createCollection,
  resolveImageUrl,
  updateCollection,
  uploadCollectionImage,
  type CollectionInput,
} from "@/lib/api";
import {
  buildCollectionTree,
  descendantIds,
  flattenCollectionTree,
  type Collection,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import ImageDropzone from "@/components/ui/ImageDropzone";
import Modal from "@/components/ui/Modal";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function CollectionFormModal({
  collection,
  collections,
  onClose,
  onSaved,
}: {
  collection: Collection | null;
  collections: Collection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(collection?.name ?? "");
  const [slug, setSlug] = useState(collection?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!collection);
  const [parentCollectionId, setParentCollectionId] = useState(
    collection?.parentCollectionId != null ? String(collection.parentCollectionId) : "",
  );
  const [displayOrder, setDisplayOrder] = useState(String(collection?.displayOrder ?? 0));
  const [isFeatured, setIsFeatured] = useState(collection?.isFeatured ?? false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(
    resolveImageUrl(collection?.image),
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
  const excluded = collection ? new Set([collection.id, ...descendantIds(collection.id, collections)]) : new Set<number>();
  const parentOptions = flattenCollectionTree(
    buildCollectionTree(collections.filter((c) => !excluded.has(c.id))),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setSaving(true);
    try {
      const order = Number(displayOrder) || 0;
      let image: string | undefined;
      if (imageFile) {
        const uploaded = await uploadCollectionImage(imageFile);
        image = uploaded.url;
      }

      if (collection) {
        const payload: Partial<CollectionInput> = {
          name,
          slug,
          displayOrder: order,
          isFeatured,
          parentCollectionId: parentCollectionId === "" ? null : Number(parentCollectionId),
          ...(image !== undefined && { image }),
        };
        await updateCollection(collection.id, payload);
        toast(`"${name}" updated`);
      } else {
        const payload: CollectionInput = { name, slug, displayOrder: order, isFeatured, image };
        if (parentCollectionId !== "") {
          payload.parentCollectionId = Number(parentCollectionId);
        }
        await createCollection(payload);
        toast(`"${name}" created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save collection", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title={collection ? `Edit "${collection.name}"` : "New collection"}>
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
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

          <Combobox
            label="Parent collection"
            value={parentCollectionId}
            onChange={setParentCollectionId}
            placeholder="None (top level)"
            options={[
              { value: "", label: "None (top level)" },
              ...parentOptions.map((c) => ({
                value: String(c.id),
                label: `${"- ".repeat(c.depth)}${c.name}`,
              })),
            ]}
          />

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

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-white dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {collection ? "Save changes" : "Create collection"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
