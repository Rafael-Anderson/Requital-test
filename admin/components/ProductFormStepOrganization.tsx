"use client";

import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Combobox from "@/components/ui/Combobox";
import Thumbnail from "@/components/ui/Thumbnail";
import CategoryCheckboxTree from "@/components/CategoryCheckboxTree";
import VariantsSection from "@/components/VariantsSection";
import AttributesSection from "@/components/AttributesSection";
import FaqsSection from "@/components/FaqsSection";
import { PRODUCT_STATUS_LABELS } from "@/lib/types";
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
  const sortedImages = [...form.images].sort((a, b) => a.order - b.order);

  return (
    <>
      <Card className="flex items-center gap-3">
        <Thumbnail src={sortedImages[0]?.url} size="size-14" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{form.name || "Untitled product"}</p>
          <p className="text-sm text-zinc-500">{form.price ? `AED ${form.price}` : "No price set"}</p>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Organization</h3>
        <div>
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Categories</label>
          <CategoryCheckboxTree
            categories={form.categories ?? []}
            selected={form.categoryIds}
            onToggle={form.toggleCategory}
          />
          {form.fieldErrors.categories && (
            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
              {form.fieldErrors.categories}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Type" value={form.productType} onChange={(e) => form.setProductType(e.target.value)} />
          <Input label="Vendor" value={form.vendor} onChange={(e) => form.setVendor(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {form.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-black/5 dark:bg-white/10 px-2.5 py-1 text-xs"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => form.removeTag(tag)}
                  aria-label={`Remove ${tag}`}
                  className="text-zinc-400 hover:text-red-600 cursor-pointer"
                >
                  ×
                </button>
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
            className="w-full border rounded px-2.5 py-1.5 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
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
            <span className="text-xs font-normal text-zinc-400">(optional — sensible defaults apply)</span>
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
              className="flex w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 transition-shadow outline-none placeholder:text-zinc-400 resize-y focus:border-accent focus:ring-[3px] focus:ring-accent/20"
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
    </>
  );
}
