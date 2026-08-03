"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createProduct,
  duplicateProduct,
  getShop,
  listCategories,
  listIngredientCategories,
  listIngredients,
  listOutlets,
  resolveImageUrl,
  updateProduct,
  updateProductAvailability,
} from "@/lib/api";
import { commitStockChanges } from "@/lib/stock";
import {
  PRODUCT_STATUS_LABELS,
  WEIGHT_UNITS,
  type Category,
  type Ingredient,
  type IngredientCategory,
  type Product,
  type StockByOutlet,
  type WeightUnit,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import Card from "@/components/ui/Card";
import PageShell from "@/components/ui/PageShell";
import RichTextEditor from "@/components/ui/RichTextEditor";
import OutletQuantityTable from "@/components/ui/OutletQuantityTable";
import CategoryCheckboxTree from "@/components/CategoryCheckboxTree";
import ProductMediaGallery, { type GalleryImage } from "@/components/ProductMediaGallery";
import VariantsSection from "@/components/VariantsSection";
import AttributesSection, { type AttributeDraft } from "@/components/AttributesSection";
import FaqsSection, { type FaqDraft } from "@/components/FaqsSection";
import IngredientRecipeEditor, { type RecipeRowDraft } from "@/components/IngredientRecipeEditor";
import { useToast } from "@/components/ui/Toast";

const PRODUCT_STATUSES = Object.keys(PRODUCT_STATUS_LABELS);

export default function ProductForm({ product: initialProduct }: { product?: Product }) {
  const router = useRouter();
  const toast = useToast();
  const [product, setProduct] = useState<Product | undefined>(initialProduct);
  const isEdit = !!product;

  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [status, setStatus] = useState(product?.status ?? "Available");
  const [images, setImages] = useState<GalleryImage[]>(
    product?.images.length
      ? product.images.map((i) => ({ url: i.url, order: i.order }))
      : product?.thumbnail
        ? [{ url: product.thumbnail, order: 0 }]
        : [],
  );

  const [price, setPrice] = useState(product?.price ?? "");
  const [compareAtPrice, setCompareAtPrice] = useState(product?.compareAtPrice ?? "");
  const [costPrice, setCostPrice] = useState("");
  const [chargeTax, setChargeTax] = useState(product?.chargeTax ?? true);
  const [isCheckoutAddon, setIsCheckoutAddon] = useState(product?.isCheckoutAddon ?? false);

  const [trackInventory, setTrackInventory] = useState(product?.trackInventory ?? false);
  const [continueSellingOutOfStock, setContinueSellingOutOfStock] = useState(
    product?.continueSellingOutOfStock ?? false,
  );
  const [sku, setSku] = useState(product?.sku ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");

  const [physicalProduct, setPhysicalProduct] = useState(product?.physicalProduct ?? true);
  const [weight, setWeight] = useState(product?.weight ?? "");
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(product?.weightUnit ?? "kg");
  const [dimensions, setDimensions] = useState(product?.dimensions ?? "");

  const [vendor, setVendor] = useState(product?.vendor ?? "");
  const [productType, setProductType] = useState(product?.productType ?? "");
  const [tags, setTags] = useState<string[]>(product?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");

  const [slug, setSlug] = useState(product?.slug ?? "");
  const [metaTitle, setMetaTitle] = useState(product?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(product?.metaDescription ?? "");
  const [categoryIds, setCategoryIds] = useState<Set<number>>(
    new Set(product?.categories.map((c) => c.id) ?? []),
  );

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [shopVariantsEnabled, setShopVariantsEnabled] = useState(false);
  const [shopAttributesEnabled, setShopAttributesEnabled] = useState(false);
  const [shopFaqsEnabled, setShopFaqsEnabled] = useState(false);
  const [attributes, setAttributes] = useState<AttributeDraft[]>(
    product?.attributes.map((a) => ({ name: a.name, value: a.value, order: a.order })) ?? [],
  );
  const [faqs, setFaqs] = useState<FaqDraft[]>(
    product?.faqs.map((f) => ({ question: f.question, answer: f.answer, order: f.order })) ?? [],
  );
  const [stockRows, setStockRows] = useState<StockByOutlet[]>([]);
  const [stockValues, setStockValues] = useState<Record<number, string>>({});
  const [ingredientsList, setIngredientsList] = useState<Ingredient[]>([]);
  const [ingredientCategories, setIngredientCategories] = useState<IngredientCategory[]>([]);
  const [recipeRows, setRecipeRows] = useState<RecipeRowDraft[]>(
    product?.ingredients.map((i) => ({ ingredientId: i.ingredientId, quantityPerUnit: String(i.quantityPerUnit) })) ??
      [],
  );
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load categories"));
    getShop()
      .then((s) => {
        setShopVariantsEnabled(s.productVariantsEnabled);
        setShopAttributesEnabled(s.productAttributesEnabled);
        setShopFaqsEnabled(s.productFaqsEnabled);
      })
      .catch(() => {});
    listIngredients()
      .then(setIngredientsList)
      .catch(() => {});
    listIngredientCategories()
      .then(setIngredientCategories)
      .catch(() => {});
    listOutlets()
      .then((outlets) => {
        const byId = new Map((product?.stockByOutlet ?? []).map((r) => [r.outletId, r.stockQuantity]));
        setStockRows(
          outlets.map((o) => ({ outletId: o.id, outletName: o.name, stockQuantity: byId.get(o.id) ?? 0 })),
        );
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCategory(id: number) {
    setCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addTag() {
    const raw = tagDraft.trim();
    if (!raw || tags.includes(raw)) return;
    setTags((t) => [...t, raw]);
    setTagDraft("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextFieldErrors: Record<string, string> = {};
    if (!name.trim()) nextFieldErrors.name = "Name is required";
    if (!sku.trim()) nextFieldErrors.sku = "SKU is required";
    if (!price) nextFieldErrors.price = "Price is required";
    if (images.length === 0) nextFieldErrors.image = "At least one image is required";
    if (categoryIds.size === 0) nextFieldErrors.categories = "Select at least one category";
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setError(null);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const sortedImages = [...images].sort((a, b) => a.order - b.order);
      const payload = {
        name,
        sku,
        barcode: barcode || undefined,
        description: description || undefined,
        price: Number(price),
        compareAtPrice: compareAtPrice ? Number(compareAtPrice) : undefined,
        costPrice: costPrice ? Number(costPrice) : undefined,
        chargeTax,
        isCheckoutAddon,
        thumbnail: sortedImages[0].url,
        images: sortedImages,
        attributes: attributes
          .filter((a) => a.name.trim() && a.value.trim())
          .map((a, i) => ({ name: a.name.trim(), value: a.value.trim(), order: i })),
        faqs: faqs
          .filter((f) => f.question.trim() && f.answer.trim())
          .map((f, i) => ({ question: f.question.trim(), answer: f.answer.trim(), order: i })),
        trackInventory,
        continueSellingOutOfStock,
        physicalProduct,
        weight: physicalProduct && weight ? Number(weight) : undefined,
        weightUnit,
        dimensions: physicalProduct ? dimensions || undefined : undefined,
        vendor: vendor || undefined,
        productType: productType || undefined,
        tags,
        categoryIds: [...categoryIds],
        // Omitted (not sent) when blank rather than sent as "" — leaves the
        // slug auto-generated-from-name on create, and leaves an existing
        // slug untouched on edit rather than clearing it.
        slug: slug || undefined,
        metaTitle: metaTitle || undefined,
        metaDescription: metaDescription || undefined,
        ingredients: recipeRows
          .filter((r) => Number(r.quantityPerUnit) > 0)
          .map((r) => ({ ingredientId: r.ingredientId, quantityPerUnit: Number(r.quantityPerUnit) })),
      };

      let saved: Product;
      if (isEdit) {
        saved = await updateProduct(product.id, payload);
        // Status is deliberately not part of UpdateProductDto (see its own
        // comment) — it lives on the dedicated, branch-accessible PATCH
        // .../availability route instead, so it goes through
        // updateProductAvailability as a separate call rather than riding
        // along in the general edit payload. Only fired when actually
        // changed, to avoid a pointless extra request on every save.
        if (status !== product.status) {
          saved = await updateProductAvailability(product.id, status);
        }
        toast(`"${name}" updated`);
      } else {
        saved = await createProduct({ ...payload, status });
        toast(`"${name}" created`);
      }

      if (trackInventory) {
        await commitStockChanges(stockRows, stockValues, { productId: saved.id });
      }

      router.push("/inventory");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save product", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    if (!product) return;
    setDuplicating(true);
    try {
      const copy = await duplicateProduct(product.id);
      toast(`Duplicated "${product.name}"`);
      router.push(`/inventory/${copy.id}/edit`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to duplicate product", "error");
    } finally {
      setDuplicating(false);
    }
  }

  const sidebar = (
    <>
      <Card>
        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
        >
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PRODUCT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Product organization</h3>
        <div>
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Categories</label>
          <CategoryCheckboxTree categories={categories ?? []} selected={categoryIds} onToggle={toggleCategory} />
          {fieldErrors.categories && (
            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
              {fieldErrors.categories}
            </p>
          )}
        </div>
        <Input label="Type" value={productType} onChange={(e) => setProductType(e.target.value)} />
        <Input label="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        {/* Collections now exist as their own real system (Settings >
            Collections) — a product's MANUAL-collection membership is
            managed from the collection's own edit page (same direction as
            Categories' own admin surface being category-first, not
            product-first), not duplicated here. */}
        <div>
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-black/5 dark:bg-white/10 px-2.5 py-1 text-xs"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => setTags((t) => t.filter((x) => x !== tag))}
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
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Add a tag and press Enter"
            className="w-full border rounded px-2.5 py-1.5 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
          />
        </div>
      </Card>
    </>
  );

  return (
    <PageShell as="form" onSubmit={handleSubmit} variant="split" aside={sidebar}>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <Card className="space-y-5">
            <Input label="Title" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} />
            <RichTextEditor label="Description" value={description} onChange={setDescription} />
          </Card>

          <Card>
            <ProductMediaGallery images={images} onChange={setImages} />
            {fieldErrors.image && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
                {fieldErrors.image}
              </p>
            )}
          </Card>

          {!product?.hasVariants && (
            <>
              <Card className="space-y-4">
                <h3 className="text-sm font-semibold">Pricing</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Input
                    label="Price (AED)"
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    error={fieldErrors.price}
                  />
                  <Input
                    label="Compare-at price"
                    type="number"
                    step="0.01"
                    value={compareAtPrice}
                    onChange={(e) => setCompareAtPrice(e.target.value)}
                  />
                  <Input
                    label="Cost per item"
                    type="number"
                    step="0.01"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Toggle checked={chargeTax} onChange={setChargeTax} />
                  <span className="text-sm">Charge tax on this product</span>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle checked={isCheckoutAddon} onChange={setIsCheckoutAddon} />
                  <span className="text-sm">Add-on at checkout</span>
                </div>
              </Card>

              <Card className="space-y-4">
                <h3 className="text-sm font-semibold">Inventory</h3>
                <div>
                  <div className="flex items-center gap-2">
                    <Toggle checked={trackInventory} onChange={setTrackInventory} />
                    <span className="text-sm">Track inventory</span>
                  </div>
                  {trackInventory && (
                    <label className="flex items-center gap-2 mt-2">
                      <Toggle checked={continueSellingOutOfStock} onChange={setContinueSellingOutOfStock} />
                      <span className="text-sm">Continue selling when out of stock</span>
                    </label>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} error={fieldErrors.sku} />
                  <Input label="Barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
                </div>
                {trackInventory && (
                  <div>
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
                      Quantity by branch
                    </label>
                    <OutletQuantityTable
                      rows={stockRows}
                      values={stockValues}
                      onChangeValue={(outletId, value) => setStockValues((v) => ({ ...v, [outletId]: value }))}
                    />
                    {product &&
                      product.makeableQuantity !== null &&
                      product.stockQuantity !== null &&
                      product.makeableQuantity < product.stockQuantity && (
                        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                          Only {product.makeableQuantity} can actually be made right now — limited by{" "}
                          {product.limitedByIngredient}. See the Recipe section below.
                        </p>
                      )}
                  </div>
                )}
              </Card>
            </>
          )}

          <Card className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Recipe</h3>
              <p className="text-xs text-zinc-400 mt-1">
                Ingredients consumed to make one unit of this product. Used as the default for every variant that
                doesn&apos;t have its own override (set per-variant in the Variants section below). Leave empty if
                this product doesn&apos;t consume tracked ingredients.
              </p>
            </div>
            <IngredientRecipeEditor
              ingredients={ingredientsList}
              categories={ingredientCategories}
              rows={recipeRows}
              onChange={setRecipeRows}
            />
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Shipping</h3>
              <label className="flex items-center gap-2">
                <Toggle checked={physicalProduct} onChange={setPhysicalProduct} />
                <span className="text-sm">Physical product</span>
              </label>
            </div>
            {physicalProduct && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      label="Weight"
                      type="number"
                      step="0.01"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Unit</label>
                    <select
                      value={weightUnit}
                      onChange={(e) => setWeightUnit(e.target.value as WeightUnit)}
                      className="flex h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
                    >
                      {WEIGHT_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <Input
                  label="Dimensions"
                  value={dimensions}
                  onChange={(e) => setDimensions(e.target.value)}
                  placeholder="e.g. 20 x 15 x 10 cm"
                />
              </div>
            )}
          </Card>

          <VariantsSection
            product={product ?? null}
            shopVariantsEnabled={shopVariantsEnabled}
            onProductUpdate={setProduct}
            images={images}
            onImagesChange={setImages}
          />

          <AttributesSection
            attributes={attributes}
            onChange={setAttributes}
            shopAttributesEnabled={shopAttributesEnabled}
          />

          <FaqsSection faqs={faqs} onChange={setFaqs} shopFaqsEnabled={shopFaqsEnabled} />

          <Card>
            <details>
              <summary className="text-sm font-medium cursor-pointer select-none">
                Search engine listing{" "}
                <span className="text-xs font-normal text-zinc-400">(optional — sensible defaults apply)</span>
              </summary>
              <div className="mt-4 space-y-4">
                <Input
                  label="URL slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder={isEdit ? undefined : "auto-generated from name if left blank"}
                />
                <Input
                  label="Meta title"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder={name || "Falls back to the product name"}
                  maxLength={255}
                />
                <textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder="Falls back to a truncated product description"
                  maxLength={500}
                  rows={3}
                  className="flex w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 transition-shadow outline-none placeholder:text-zinc-400 resize-y focus:border-accent focus:ring-[3px] focus:ring-accent/20"
                />
              </div>
            </details>
          </Card>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/inventory")}>
          Cancel
        </Button>
        {isEdit && (
          <Button type="button" variant="secondary" onClick={handleDuplicate} disabled={duplicating}>
            {duplicating ? "Duplicating…" : "Duplicate"}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={saving}>
          {isEdit ? "Save changes" : "Create product"}
        </Button>
      </div>
    </PageShell>
  );
}
