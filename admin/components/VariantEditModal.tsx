"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import {
  listIngredientCategories,
  listIngredients,
  resolveImageUrl,
  updateProduct,
  updateVariant,
  uploadProductImage,
} from "@/lib/api";
import { commitStockChanges } from "@/lib/stock";
import type { Ingredient, IngredientCategory, Product, ProductImage, ProductVariant } from "@/lib/types";
import type { GalleryImage } from "@/components/ProductMediaGallery";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import OutletQuantityTable from "@/components/ui/OutletQuantityTable";
import IngredientRecipeEditor, { type RecipeRowDraft } from "@/components/IngredientRecipeEditor";
import { useToast } from "@/components/ui/Toast";

export default function VariantEditModal({
  product,
  variant,
  images,
  onImagesChange,
  onClose,
  onSaved,
}: {
  product: Product;
  variant: ProductVariant;
  // Live Media gallery (see VariantsSection's own comment on this prop) —
  // read for the picker instead of product.images so a just-uploaded image
  // shows up immediately, not only after the whole product form is saved.
  images: GalleryImage[];
  onImagesChange: (images: GalleryImage[]) => void;
  onClose: () => void;
  // Second argument is only passed when picking/uploading an image required
  // persisting the gallery mid-edit (see handleSubmit) — the caller should
  // fold it into its own product.images so the next variant edited in this
  // session resolves ids without another round trip.
  onSaved: (updated: ProductVariant, refreshedImages?: ProductImage[]) => void;
}) {
  const toast = useToast();
  const [sku, setSku] = useState(variant.sku ?? "");
  const [barcode, setBarcode] = useState(variant.barcode ?? "");
  const [price, setPrice] = useState(variant.price ?? "");
  const [compareAtPrice, setCompareAtPrice] = useState(variant.compareAtPrice ?? "");
  const [weight, setWeight] = useState(variant.weight ?? "");
  // Tracked by url, not id — a newly-uploaded-this-session image has a real
  // url (upload already happened) but no productimage row/id yet, so id
  // can't be the source of truth while editing. Resolved to a real id in
  // handleSubmit, persisting the gallery first if needed.
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(
    product.images.find((img) => img.id === variant.imageId)?.url ?? null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadingVariantImage, setUploadingVariantImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stockValues, setStockValues] = useState<Record<number, string>>({});
  const [ingredientsList, setIngredientsList] = useState<Ingredient[]>([]);
  const [ingredientCategories, setIngredientCategories] = useState<IngredientCategory[]>([]);
  const [recipeRows, setRecipeRows] = useState<RecipeRowDraft[]>(
    variant.ingredientOverrides.map((i) => ({
      ingredientId: i.ingredientId,
      quantityPerUnit: String(i.quantityPerUnit),
    })),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listIngredients()
      .then(setIngredientsList)
      .catch(() => {});
    listIngredientCategories()
      .then(setIngredientCategories)
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // React re-fires bubbling synthetic events along the component tree,
    // not the (portaled) DOM tree — without this, submitting this form
    // still also triggers ProductForm's own onSubmit one level up.
    e.stopPropagation();
    setSaving(true);
    try {
      let imageId: number | null = null;
      let refreshedImages: ProductImage[] | undefined;
      if (selectedImageUrl) {
        const existing = product.images.find((img) => img.url === selectedImageUrl);
        if (existing) {
          imageId = existing.id;
        } else {
          // Picked (or just uploaded) an image that only exists in this
          // session's live gallery so far — persist the full gallery now
          // (same "replaces the full set" semantics the page's own Save
          // button uses) so it gets a real productimage row, then resolve
          // its id from the response.
          const synced = await updateProduct(product.id, {
            images: images.map((img, i) => ({ url: img.url, order: img.order ?? i })),
          });
          refreshedImages = synced.images;
          imageId = synced.images.find((img) => img.url === selectedImageUrl)?.id ?? null;
        }
      }

      const updated = await updateVariant(product.id, variant.id, {
        sku: sku || undefined,
        barcode: barcode || undefined,
        price: price ? Number(price) : undefined,
        compareAtPrice: compareAtPrice ? Number(compareAtPrice) : undefined,
        weight: weight ? Number(weight) : undefined,
        imageId,
        ingredients: recipeRows
          .filter((r) => Number(r.quantityPerUnit) > 0)
          .map((r) => ({ ingredientId: r.ingredientId, quantityPerUnit: Number(r.quantityPerUnit) })),
      });
      if (product.trackInventory && variant.stockByOutlet) {
        await commitStockChanges(variant.stockByOutlet, stockValues, {
          productId: product.id,
          variantId: variant.id,
        });
      }
      toast(`"${variant.label}" updated`);
      onSaved(updated, refreshedImages);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save variant", "error");
    } finally {
      setSaving(false);
    }
  }

  // "Upload a variant-specific image" — adds straight to the shared Media
  // gallery (there's no separate variant-only image storage; a variant's
  // imageId always references a real productimage row) and selects it for
  // this variant. Uploading the file itself is immediate/real either way
  // (see ProductMediaGallery's own comment) — only the productimage row/id
  // is deferred, resolved in handleSubmit like any other newly-added image.
  async function handleUploadNewImage(file: File) {
    setUploadingVariantImage(true);
    try {
      const uploaded = await uploadProductImage(file);
      const next = [...images, { url: uploaded.url, order: images.length }].map((img, i) => ({ ...img, order: i }));
      onImagesChange(next);
      setSelectedImageUrl(uploaded.url);
      setPickerOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to upload image", "error");
    } finally {
      setUploadingVariantImage(false);
    }
  }

  // Portaled to <body> rather than rendered inline — this modal's own
  // <form> would otherwise land as a DOM descendant of ProductForm's own
  // top-level <form>, and nested <form> elements are invalid HTML: the
  // browser attributes the "Save changes" submit to the outer product form
  // instead of this one, so the variant edit is silently lost (or a
  // whole-product save fires instead). Every other modal in this app is
  // fine as a plain inline div — this is the only one ever mounted inside
  // a page that's itself a <form>.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto modal-scroll rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <h2 className="text-lg font-semibold mb-4">{variant.label ?? "Variant"}</h2>

        <div className="space-y-3.5">
          <div className="relative">
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Image</label>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              className="size-16 rounded-md border-2 border-dashed border-black/15 dark:border-white/15 flex items-center justify-center overflow-hidden cursor-pointer hover:border-accent/60 transition-colors"
            >
              {selectedImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resolveImageUrl(selectedImageUrl) ?? ""} alt="" className="w-full h-full object-cover" />
              ) : (
                <Plus className="size-5 text-zinc-400" />
              )}
            </button>

            {pickerOpen && (
              <>
                {/* Click-outside-to-close backdrop, scoped to this modal — a
                    plain document click listener would also have to special-
                    case the portal boundary; this is simpler and every other
                    dropdown-ish control in this app (DropdownMenu) uses the
                    same pattern. */}
                <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                <div
                  role="menu"
                  className="absolute z-20 top-full left-0 mt-1.5 w-64 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg p-3"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingVariantImage}
                    className="w-full text-sm text-left px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploadingVariantImage ? "Uploading…" : "Upload new image"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadNewImage(file);
                      e.target.value = "";
                    }}
                  />

                  {images.length > 0 && (
                    <>
                      <p className="text-xs text-zinc-400 mt-2 mb-1.5 px-2 border-t border-black/5 dark:border-white/10 pt-2">
                        Or choose from existing photos:
                      </p>
                      <div className="flex flex-wrap gap-1.5 px-2">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSelectedImageUrl(null);
                            setPickerOpen(false);
                          }}
                          aria-label="No image"
                          className={`size-10 rounded border-2 flex items-center justify-center text-[9px] text-zinc-400 cursor-pointer transition-colors ${
                            selectedImageUrl === null
                              ? "border-accent"
                              : "border-transparent hover:border-black/20 dark:hover:border-white/20"
                          }`}
                        >
                          None
                        </button>
                        {images.map((img) => (
                          <button
                            key={img.url}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setSelectedImageUrl(img.url);
                              setPickerOpen(false);
                            }}
                            aria-label="Use this photo"
                            className={`size-10 rounded border-2 overflow-hidden cursor-pointer transition-colors ${
                              selectedImageUrl === img.url
                                ? "border-accent"
                                : "border-transparent hover:border-black/20 dark:hover:border-white/20"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={resolveImageUrl(img.url) ?? ""} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Price"
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={product.price}
            />
            <Input
              label="Compare-at price"
              type="number"
              step="0.01"
              value={compareAtPrice}
              onChange={(e) => setCompareAtPrice(e.target.value)}
              placeholder={product.compareAtPrice ?? undefined}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} placeholder={product.sku} />
            <Input label="Barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>

          {product.physicalProduct && (
            <Input
              label={`Weight (${product.weightUnit})`}
              type="number"
              step="0.01"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder={product.weight ?? undefined}
            />
          )}

          {product.trackInventory && (
            <div>
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
                Inventory
              </label>
              {variant.stockByOutlet ? (
                <OutletQuantityTable
                  rows={variant.stockByOutlet}
                  values={stockValues}
                  onChangeValue={(outletId, value) => setStockValues((v) => ({ ...v, [outletId]: value }))}
                />
              ) : (
                <p className="text-xs text-zinc-400">Stock quantities load once opened from the edit page.</p>
              )}
              {variant.makeableQuantity !== null &&
                variant.stockQuantity !== null &&
                variant.makeableQuantity < variant.stockQuantity && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    Only {variant.makeableQuantity} can actually be made right now — limited by{" "}
                    {variant.limitedByIngredient}.
                  </p>
                )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
              Recipe override
            </label>
            <p className="text-xs text-zinc-400 mb-1.5">
              Leave empty to use the product&apos;s default recipe for this variant. Add rows here only if this
              variant consumes a different amount (e.g. Large uses more than Small).
            </p>
            <IngredientRecipeEditor
              ingredients={ingredientsList}
              categories={ingredientCategories}
              rows={recipeRows}
              onChange={setRecipeRows}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            Save changes
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
