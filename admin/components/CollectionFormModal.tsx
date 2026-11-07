"use client";

import { useEffect, useState } from "react";
import {
  createCollection,
  getCollection,
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
  type CollectionRule,
} from "@/lib/types";
import { isRuleComplete } from "@/lib/collection-rules";
import CollectionRulesEditor from "@/components/CollectionRulesEditor";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Toggle from "@/components/ui/Toggle";
import ImageDropzone from "@/components/ui/ImageDropzone";
import Modal from "@/components/ui/Modal";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";
import { useMetafieldEditor } from "@/lib/useMetafieldEditor";
import { MetafieldsSection } from "@/components/MetafieldsFields";

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
  const [description, setDescription] = useState(collection?.description ?? "");
  const [displayOrder, setDisplayOrder] = useState(String(collection?.displayOrder ?? 0));
  const [isFeatured, setIsFeatured] = useState(collection?.isFeatured ?? false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(
    resolveImageUrl(collection?.image),
  );
  const [saving, setSaving] = useState(false);
  const [collectionType, setCollectionType] = useState<"manual" | "automated">(
    collection?.collectionType ?? "manual",
  );
  const [matchMode, setMatchMode] = useState<"all" | "any">(collection?.matchMode ?? "all");
  const [rules, setRules] = useState<CollectionRule[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(!collection || collection.collectionType !== "automated");
  const [rulesError, setRulesError] = useState<string | null>(null);
  const metafields = useMetafieldEditor("collection", collection?.id ?? null);
  const toast = useToast();

  function handleFileSelected(file: File) {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  // An existing automated collection's conditions come from the detail read.
  useEffect(() => {
    if (!collection || collection.collectionType !== "automated") return;
    let cancelled = false;
    getCollection(collection.id)
      .then((full) => {
        if (cancelled) return;
        setRules(full.rules ?? []);
        setMatchMode(full.matchMode ?? "all");
        setRulesLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) setRulesError(err instanceof Error ? err.message : "Could not load the conditions");
      });
    return () => {
      cancelled = true;
    };
  }, [collection]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  // Exclude self and all descendants from the parent dropdown so a
  // reassignment can never create a cycle client-side (backend re-checks).
  const excluded = collection ? new Set([collection.id, ...descendantIds(collection.id, collections)]) : new Set<number>();
  const parentOptions = flattenCollectionTree(
    buildCollectionTree(collections.filter((c) => !excluded.has(c.id))),
  );

  // The collection itself is already saved by the time this runs, so a failure
  // here says so rather than reporting the whole save as failed.
  async function saveMetafields(id: number) {
    await metafields.save(id).catch((err: unknown) => {
      throw new Error(
        `Collection saved, but custom fields were not: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    if (collectionType === "automated") {
      if (!rulesLoaded) return;
      if (!rules.every(isRuleComplete)) {
        toast("Finish or remove the incomplete conditions", "error");
        return;
      }
    }
    const metafieldError = metafields.validate();
    if (metafieldError) {
      toast(metafieldError, "error");
      return;
    }
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
          description,
          parentCollectionId: parentCollectionId === "" ? null : Number(parentCollectionId),
          collectionType,
          ...(collectionType === "automated" && { matchMode, rules }),
          ...(image !== undefined && { image }),
        };
        await updateCollection(collection.id, payload);
        await saveMetafields(collection.id);
        toast(`"${name}" updated`);
      } else {
        const payload: CollectionInput = {
          name,
          slug,
          displayOrder: order,
          isFeatured,
          description,
          image,
          collectionType,
          ...(collectionType === "automated" && { matchMode, rules }),
        };
        if (parentCollectionId !== "") {
          payload.parentCollectionId = Number(parentCollectionId);
        }
        const created = await createCollection(payload);
        await saveMetafields(created.id);
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
    <Modal onClose={onClose} size={collectionType === "automated" ? "lg" : "sm"} title={collection ? `Edit "${collection.name}"` : "New collection"}>
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

          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown on this collection's own storefront page"
            rows={3}
          />

          <Input
            label="Display order"
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />

          <ImageDropzone preview={imagePreview} onFileSelected={handleFileSelected} />

          <div className="flex items-center gap-2">
            <Toggle
              checked={isFeatured}
              onChange={setIsFeatured}
              tooltip="Gives this collection priority placement wherever the storefront homepage highlights collections."
            />
            <span className="text-sm">Featured on homepage</span>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-medium">Collection type</span>
            <SegmentedToggle
              value={collectionType}
              onChange={setCollectionType}
              options={[
                { value: "manual", label: "Manual" },
                { value: "automated", label: "Automated" },
              ]}
            />
            <p className="text-xs text-zinc-500">
              {collectionType === "manual"
                ? "You add products to this collection yourself, from each product's Organization step."
                : "Products join this collection automatically when they match your conditions."}
            </p>
          </div>

          {collectionType === "automated" &&
            (rulesError ? (
              <p className="text-sm text-red-600" role="alert">
                {rulesError}
              </p>
            ) : rulesLoaded ? (
              <CollectionRulesEditor
                matchMode={matchMode}
                onMatchModeChange={setMatchMode}
                rules={rules}
                onRulesChange={setRules}
                manualCollections={collections.filter(
                  (c) => (c.collectionType ?? "manual") === "manual",
                )}
              />
            ) : (
              <p className="text-sm text-zinc-500">Loading conditions...</p>
            ))}

          <MetafieldsSection editor={metafields} />
        </div>

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
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
