"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createProduct,
  duplicateProduct,
  getShop,
  listCollections,
  listIngredientCategories,
  listIngredients,
  listOutlets,
  updateProduct,
  updateProductAvailability,
} from "@/lib/api";
import { commitStockChanges } from "@/lib/stock";
import {
  PRODUCT_STATUS_LABELS,
  type Collection,
  type Ingredient,
  type IngredientCategory,
  type Product,
  type StockByOutlet,
  type WeightUnit,
} from "@/lib/types";
import type { GalleryImage } from "@/components/ProductMediaGallery";
import type { AttributeDraft } from "@/components/AttributesSection";
import type { FaqDraft } from "@/components/FaqsSection";
import type { RecipeRowDraft } from "@/components/IngredientRecipeEditor";
import { useToast } from "@/components/ui/Toast";

export const PRODUCT_STATUSES = Object.keys(PRODUCT_STATUS_LABELS);

// Which wizard step a validated field lives on — used to jump the user back
// to the earliest step containing an error when the final submit fails
// validation for a field that isn't visible on the current step (e.g. SKU
// missing while reviewing Step 3).
export const FIELD_STEP: Record<string, number> = {
  name: 0,
  image: 0,
  sku: 1,
  price: 1,
  collections: 2,
};

// All product-form state and save logic, unchanged from the pre-wizard
// single-page form — only the JSX presentation was split into steps.
export function useProductForm(initialProduct: Product | undefined) {
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
  const [collectionIds, setCollectionIds] = useState<Set<number>>(
    new Set(product?.collections.map((c) => c.id) ?? []),
  );

  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [productEditorMode, setProductEditorMode] = useState<"simple" | "advanced">("simple");
  const [showVariants, setShowVariants] = useState(product?.showVariants ?? false);
  const [showAttributes, setShowAttributes] = useState(product?.showAttributes ?? false);
  const [showFaqs, setShowFaqs] = useState(product?.showFaqs ?? false);
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
    listCollections()
      .then(setCollections)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load collections"));
    getShop()
      .then((s) => {
        setProductEditorMode(s.productEditorMode ?? "simple");
        // Only a brand-new product picks up the shop's mode as its starting
        // point — an existing product keeps whatever was already saved for
        // it (see the showVariants/etc. initial state above), regardless of
        // what the shop's current mode is.
        if (!product) {
          const advancedDefault = s.productEditorMode === "advanced";
          setShowVariants(advancedDefault);
          setShowAttributes(advancedDefault);
          setShowFaqs(advancedDefault);
        }
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

  function toggleCollection(id: number) {
    setCollectionIds((prev) => {
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

  function removeTag(tag: string) {
    setTags((t) => t.filter((x) => x !== tag));
  }

  // Gate for the wizard's Step 1 "Next" button — only Title is required to
  // advance. The full set of required fields (name/sku/price/image/collection)
  // is still enforced at final submit time, unchanged from the old form.
  function validateStep1(): boolean {
    if (!name.trim()) {
      setFieldErrors((prev) => ({ ...prev, name: "Name is required" }));
      return false;
    }
    setFieldErrors((prev) => {
      if (!("name" in prev)) return prev;
      const rest = { ...prev };
      delete rest.name;
      return rest;
    });
    return true;
  }

  // Returns the field errors from the same validation the old single-page
  // form always ran at submit — unchanged. Callers use FIELD_STEP to decide
  // whether to jump the wizard back to an earlier step when one of these
  // fails on a field not visible on the current step.
  function validateAll(): Record<string, string> {
    const nextFieldErrors: Record<string, string> = {};
    if (!name.trim()) nextFieldErrors.name = "Name is required";
    if (!sku.trim()) nextFieldErrors.sku = "SKU is required";
    if (!price) nextFieldErrors.price = "Price is required";
    if (images.length === 0) nextFieldErrors.image = "At least one image is required";
    if (collectionIds.size === 0) nextFieldErrors.collections = "Select at least one collection";
    return nextFieldErrors;
  }

  async function handleSubmit(): Promise<{ ok: boolean; fieldErrors: Record<string, string> }> {
    const nextFieldErrors = validateAll();
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setError(null);
      return { ok: false, fieldErrors: nextFieldErrors };
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
        showVariants,
        showAttributes,
        showFaqs,
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
        collectionIds: [...collectionIds],
        slug: slug || undefined,
        metaTitle: metaTitle || undefined,
        metaDescription: metaDescription || undefined,
        ingredients: recipeRows
          .filter((r) => Number(r.quantityPerUnit) > 0)
          .map((r) => ({ ingredientId: r.ingredientId, quantityPerUnit: Number(r.quantityPerUnit) })),
      };

      let saved: Product;
      if (isEdit && product) {
        saved = await updateProduct(product.id, payload);
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
      return { ok: true, fieldErrors: {} };
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save product", "error");
      return { ok: false, fieldErrors: {} };
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

  return {
    router,
    product,
    isEdit,
    name, setName,
    description, setDescription,
    status, setStatus,
    images, setImages,
    price, setPrice,
    compareAtPrice, setCompareAtPrice,
    costPrice, setCostPrice,
    chargeTax, setChargeTax,
    isCheckoutAddon, setIsCheckoutAddon,
    trackInventory, setTrackInventory,
    continueSellingOutOfStock, setContinueSellingOutOfStock,
    sku, setSku,
    barcode, setBarcode,
    physicalProduct, setPhysicalProduct,
    weight, setWeight,
    weightUnit, setWeightUnit,
    dimensions, setDimensions,
    vendor, setVendor,
    productType, setProductType,
    tags, tagDraft, setTagDraft, addTag, removeTag,
    slug, setSlug,
    metaTitle, setMetaTitle,
    metaDescription, setMetaDescription,
    collectionIds, toggleCollection,
    collections,
    productEditorMode,
    showVariants, setShowVariants,
    showAttributes, setShowAttributes,
    showFaqs, setShowFaqs,
    attributes, setAttributes,
    faqs, setFaqs,
    stockRows,
    stockValues, setStockValues,
    ingredientsList,
    ingredientCategories,
    recipeRows, setRecipeRows,
    saving,
    duplicating,
    error,
    fieldErrors, setFieldErrors,
    validateStep1,
    validateAll,
    handleSubmit,
    handleDuplicate,
    setProduct,
  };
}

export type ProductFormState = ReturnType<typeof useProductForm>;
