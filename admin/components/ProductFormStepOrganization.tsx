"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Combobox from "@/components/ui/Combobox";
import MultiCombobox from "@/components/ui/MultiCombobox";
import Modal from "@/components/ui/Modal";
import Thumbnail from "@/components/ui/Thumbnail";
import VariantsSection from "@/components/VariantsSection";
import AttributesSection from "@/components/AttributesSection";
import FaqsSection from "@/components/FaqsSection";
import AdditionalInfoSection from "@/components/AdditionalInfoSection";
import Tooltip from "@/components/ui/Tooltip";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { useToast } from "@/components/ui/Toast";
import {
  createBrand,
  createCollection,
  resolveImageUrl,
  uploadBrandImage,
} from "@/lib/api";
import {
  PRODUCT_STATUS_LABELS,
  buildCollectionTree,
  flattenCollectionTree,
} from "@/lib/types";
import { PRODUCT_STATUSES, type ProductFormState } from "@/lib/useProductForm";

export default function ProductFormStepOrganization({
  form,
  hideFeatureSections,
}: {
  form: ProductFormState;
  // Advanced mode renders Variants/Attributes/FAQs as their own top-level
  // anchor sections above this one (see ProductForm.tsx) — set this so they
  // aren't rendered twice.
  hideFeatureSections?: boolean;
}) {
  const toast = useToast();
  const sortedImages = [...form.images].sort((a, b) => a.order - b.order);

  const collectionOptions = flattenCollectionTree(
    buildCollectionTree(form.collections ?? []),
  ).map((c) => ({ value: String(c.id), label: c.name, depth: c.depth }));
  const brandOptions = form.brands.map((b) => ({
    value: String(b.id),
    label: b.name,
  }));

  // Inline "create new" from inside the selectors — happens in a modal so
  // the product form never unmounts and unsaved edits survive.
  const [creating, setCreating] = useState<"collection" | "brand" | null>(null);
  const [newName, setNewName] = useState("");
  const [newBrandLogo, setNewBrandLogo] = useState<string | null>(null);
  const [savingNew, setSavingNew] = useState(false);

  function openCreate(kind: "collection" | "brand") {
    setNewName("");
    setNewBrandLogo(null);
    setCreating(kind);
  }

  async function saveNew() {
    const name = newName.trim();
    if (!name) return;
    setSavingNew(true);
    try {
      if (creating === "collection") {
        const created = await createCollection({ name });
        form.setCollections([...(form.collections ?? []), created]);
        form.toggleCollection(created.id);
      } else {
        const created = await createBrand({ name, logoUrl: newBrandLogo });
        form.setBrands([...form.brands, created]);
        form.setBrandId(created.id);
      }
      setCreating(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create", "error");
    } finally {
      setSavingNew(false);
    }
  }

  async function handleBrandLogoUpload(file: File) {
    try {
      const { url } = await uploadBrandImage(file);
      setNewBrandLogo(url);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    }
  }

  return (
    <>
      <Card className="flex items-center gap-3">
        <Thumbnail src={sortedImages[0]?.url} size="size-14" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{form.name || "Untitled product"}</p>
          <p className="text-sm text-text-muted">{form.price ? `AED ${form.price}` : "No price set"}</p>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Organization</h3>
        <div>
          <MultiCombobox
            label="Collections"
            options={collectionOptions}
            value={[...form.collectionIds].map(String)}
            onChange={(next) => {
              const nextSet = new Set(next.map(Number));
              // Reconcile against the form's Set via its own toggle.
              for (const id of nextSet) if (!form.collectionIds.has(id)) form.toggleCollection(id);
              for (const id of form.collectionIds) if (!nextSet.has(id)) form.toggleCollection(id);
            }}
            placeholder="Select collections"
            searchPlaceholder="Search collections"
            emptyText="No collections yet"
            onCreateNew={() => openCreate("collection")}
            createLabel="Create new collection"
          />
          {form.fieldErrors.collections && (
            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
              {form.fieldErrors.collections}
            </p>
          )}
        </div>
        <div>
          <MultiCombobox
            single
            label="Brand"
            options={brandOptions}
            value={form.brandId ? [String(form.brandId)] : []}
            onChange={(next) => form.setBrandId(next[0] ? Number(next[0]) : null)}
            placeholder="No brand"
            searchPlaceholder="Search brands"
            emptyText="No brands yet"
            onCreateNew={() => openCreate("brand")}
            createLabel="Create new brand"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Type" value={form.productType} onChange={(e) => form.setProductType(e.target.value)} />
          <Input label="Vendor" value={form.vendor} onChange={(e) => form.setVendor(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {form.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-black/5 dark:bg-white/10 px-2.5 py-1 text-xs"
              >
                {tag}
                <Tooltip label={`Remove ${tag}`}>
                  <button
                    type="button"
                    onClick={() => form.removeTag(tag)}
                    aria-label={`Remove ${tag}`}
                    className="text-text-faint hover:text-red-600 cursor-pointer"
                  >
                    ×
                  </button>
                </Tooltip>
              </span>
            ))}
          </div>
          <input
            type="text"
            value={form.tagDraft}
            onChange={(e) => form.setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                form.addTag();
              }
            }}
            placeholder="Add a tag and press Enter"
            className="w-full border border-border dark:border-white/15 rounded px-2.5 py-1.5 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
          />
        </div>
      </Card>

      {!hideFeatureSections && (
        <>
          <VariantsSection
            product={form.product ?? null}
            enabled={form.showVariants}
            defaultOpen={form.productEditorMode !== "advanced"}
            onEnable={() => form.setShowVariants(true)}
            onDisable={() => form.setShowVariants(false)}
            onProductUpdate={form.setProduct}
            images={form.images}
            onImagesChange={form.setImages}
          />

          <AttributesSection
            attributes={form.attributes}
            onChange={form.setAttributes}
            enabled={form.showAttributes}
            defaultOpen={form.productEditorMode !== "advanced"}
            onEnable={() => form.setShowAttributes(true)}
            onDisable={() => form.setShowAttributes(false)}
          />

          <FaqsSection
            faqs={form.faqs}
            onChange={form.setFaqs}
            enabled={form.showFaqs}
            defaultOpen={form.productEditorMode !== "advanced"}
            onEnable={() => form.setShowFaqs(true)}
            onDisable={() => form.setShowFaqs(false)}
          />
        </>
      )}

      <Card>
        <details>
          <summary className="text-sm font-medium cursor-pointer select-none">
            Search engine listing{" "}
            <span className="text-xs font-normal text-text-faint">(optional, sensible defaults apply)</span>
          </summary>
          <div className="mt-4 space-y-4">
            <Input
              label="URL slug"
              value={form.slug}
              onChange={(e) => form.setSlug(e.target.value)}
              placeholder={form.isEdit ? undefined : "auto-generated from name if left blank"}
            />
            <Input
              label="Meta title"
              value={form.metaTitle}
              onChange={(e) => form.setMetaTitle(e.target.value)}
              placeholder={form.name || "Falls back to the product name"}
              maxLength={255}
            />
            <textarea
              value={form.metaDescription}
              onChange={(e) => form.setMetaDescription(e.target.value)}
              placeholder="Falls back to a truncated product description"
              maxLength={500}
              rows={3}
              className="flex w-full rounded-lg border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 transition-shadow outline-none placeholder:text-text-faint resize-y focus:border-accent focus:ring-[3px] focus:ring-accent/20"
            />
          </div>
        </details>
      </Card>

      <Card>
        <Combobox
          label="Status"
          value={form.status}
          onChange={(value) => form.setStatus(value)}
          options={PRODUCT_STATUSES.map((s) => ({ value: s, label: PRODUCT_STATUS_LABELS[s] }))}
        />
      </Card>

      {/* Not gated by hideFeatureSections/productEditorMode — unlike
          Variants/Attributes/FAQs, this has no separate advanced-mode
          anchor elsewhere, so it always renders exactly once here. */}
      <AdditionalInfoSection blocks={form.additionalInfo} onChange={form.setAdditionalInfo} />

      {creating && (
        <Modal
          size="sm"
          title={creating === "collection" ? "New collection" : "New brand"}
          onClose={() => setCreating(null)}
        >
          {(requestClose) => (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveNew();
              }}
              className="space-y-4"
            >
              <Input
                label="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                required
              />
              {creating === "brand" && (
                <ImageDropzone
                  label="Logo (optional)"
                  preview={resolveImageUrl(newBrandLogo)}
                  onFileSelected={(file) => void handleBrandLogoUpload(file)}
                />
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={requestClose}>
                  Cancel
                </Button>
                <Button type="submit" loading={savingNew} disabled={!newName.trim()}>
                  Create
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
