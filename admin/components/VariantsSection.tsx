"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus, X } from "lucide-react";
import { resolveImageUrl, updateProductOptions } from "@/lib/api";
import type { Product, ProductVariant } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import Thumbnail from "@/components/ui/Thumbnail";
import { useToast } from "@/components/ui/Toast";
import VariantEditModal from "@/components/VariantEditModal";
import type { GalleryImage } from "@/components/ProductMediaGallery";

interface OptionDraft {
  name: string;
  values: string[];
}

const MAX_OPTIONS = 3;

function fromProduct(product: Product): OptionDraft[] {
  return product.options.map((o) => ({ name: o.name, values: o.values.map((v) => v.value) }));
}

// Options only exist against a real product id (PUT /products/:id/options),
// so this section is edit-mode only — a new, unsaved product shows a note
// instead. Also gated behind shop.productVariantsEnabled (Settings > Store
// Configuration), previously a placeholder with no feature behind it.
export default function VariantsSection({
  product,
  shopVariantsEnabled,
  onProductUpdate,
  images,
  onImagesChange,
}: {
  product: Product | null;
  shopVariantsEnabled: boolean;
  onProductUpdate: (product: Product) => void;
  // The live Media gallery being edited above, not product.images — a
  // newly-added image is real (already uploaded, has a url) as soon as it's
  // added here, but doesn't get a productimage row (and therefore an id)
  // until the whole product is next saved. The variant image picker reads
  // from this instead of the stale product.images prop so a just-added
  // image shows up immediately, and resolves/persists its id on demand
  // when actually assigned (see VariantEditModal).
  images: GalleryImage[];
  onImagesChange: (images: GalleryImage[]) => void;
}) {
  const toast = useToast();
  const [options, setOptions] = useState<OptionDraft[]>(product ? fromProduct(product) : []);
  const [valueDraft, setValueDraft] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);

  if (!product) {
    return (
      <Card>
        <h3 className="text-sm font-semibold mb-1">Variants</h3>
        <p className="text-sm text-zinc-500">Save the product first to add options like size or color.</p>
      </Card>
    );
  }

  if (!shopVariantsEnabled) {
    return (
      <Card>
        <h3 className="text-sm font-semibold mb-1">Variants</h3>
        <p className="text-sm text-zinc-500">
          Enable product variants in{" "}
          <Link href="/settings/business/store-configuration" className="text-accent-text hover:underline">
            Settings &gt; Store Configuration
          </Link>{" "}
          to add options like size or color.
        </p>
      </Card>
    );
  }

  function addOption() {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((o) => [...o, { name: "", values: [] }]);
  }

  function removeOption(index: number) {
    setOptions((o) => o.filter((_, i) => i !== index));
  }

  function renameOption(index: number, name: string) {
    setOptions((o) => o.map((opt, i) => (i === index ? { ...opt, name } : opt)));
  }

  // "Red, Blue, White" + Enter adds three values, not one literal string
  // containing commas — split first, trim each piece, drop empties (a
  // trailing/doubled comma shouldn't create a blank value), then dedupe
  // against what's already there. A plain single value with no comma at
  // all still goes through the same path unchanged.
  function addValue(index: number) {
    const parts = [
      ...new Set(
        (valueDraft[index] ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
    if (parts.length === 0) return;
    setOptions((o) =>
      o.map((opt, i) => {
        if (i !== index) return opt;
        const additions = parts.filter((v) => !opt.values.includes(v));
        return additions.length > 0 ? { ...opt, values: [...opt.values, ...additions] } : opt;
      }),
    );
    setValueDraft((v) => ({ ...v, [index]: "" }));
  }

  function removeValue(index: number, value: string) {
    setOptions((o) => o.map((opt, i) => (i === index ? { ...opt, values: opt.values.filter((v) => v !== value) } : opt)));
  }

  // Arrow function (not a hoisted function declaration) so TS keeps the
  // `product` non-null narrowing from the guard above inside this closure.
  const handleSaveOptions = async () => {
    const cleaned = options.map((o) => ({ name: o.name.trim(), values: o.values })).filter((o) => o.name);
    setSaving(true);
    try {
      const updated = await updateProductOptions(product.id, cleaned);
      onProductUpdate(updated);
      setOptions(fromProduct(updated));
      toast("Options saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save options", "error");
    } finally {
      setSaving(false);
    }
  };

  const totalVariants = options.reduce((n, o) => n * Math.max(o.values.length, 1), options.length > 0 ? 1 : 0);

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">Options</h3>
        <p className="text-xs text-zinc-400 mb-3">
          Up to {MAX_OPTIONS} options (e.g. Size, Color). Adding or editing values regenerates the variant list below —
          variants that still match an existing combination keep their price/SKU/stock.
        </p>
        <div className="space-y-3">
          {options.map((option, index) => (
            <div key={index} className="rounded-lg border dark:border-white/10 p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1">
                  <Input
                    label="Option name"
                    value={option.name}
                    onChange={(e) => renameOption(index, e.target.value)}
                    placeholder="e.g. Size"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeOption(index)}
                  aria-label="Remove option"
                  className="p-1.5 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                >
                  <X className="size-4" />
                </button>
              </div>
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
                Option values
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {option.values.map((value) => (
                  <span
                    key={value}
                    className="inline-flex items-center gap-1 rounded-full bg-black/5 dark:bg-white/10 px-2.5 py-1 text-xs"
                  >
                    {value}
                    <button
                      type="button"
                      onClick={() => removeValue(index, value)}
                      aria-label={`Remove ${value}`}
                      className="text-zinc-400 hover:text-red-600 cursor-pointer"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={valueDraft[index] ?? ""}
                onChange={(e) => setValueDraft((v) => ({ ...v, [index]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addValue(index);
                  }
                }}
                placeholder="Add a value and press Enter"
                className="w-full border rounded px-2.5 py-1.5 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Button type="button" variant="secondary" size="sm" onClick={addOption} disabled={options.length >= MAX_OPTIONS}>
            <Plus className="size-3.5 inline -mt-0.5 mr-1" />
            Add option
          </Button>
          {options.length > 0 && (
            <Button type="button" variant="primary" size="sm" onClick={handleSaveOptions} disabled={saving}>
              Save options
            </Button>
          )}
          {totalVariants > 0 && <span className="text-xs text-zinc-400">{totalVariants} variants</span>}
        </div>
      </div>

      {product.variants.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Variants</h3>
          <Table>
            <THead>
              <tr>
                <TH>Variant</TH>
                <TH className="w-24">Price</TH>
                <TH className="w-24">Available</TH>
                <TH className="w-10"></TH>
              </tr>
            </THead>
            <TBody>
              {product.variants.map((v) => (
                <TR key={v.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Thumbnail src={resolveImageUrl(v.imageUrl) ?? product.thumbnail} size="size-9" />
                      <span className="font-medium">{v.label}</span>
                    </div>
                  </TD>
                  <TD>{v.price ?? product.price} AED</TD>
                  <TD className="text-zinc-500">{v.stockQuantity ?? "—"}</TD>
                  <TD>
                    <button
                      type="button"
                      onClick={() => setEditingVariant(v)}
                      className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                      aria-label={`Edit ${v.label}`}
                    >
                      <Pencil className="size-4" />
                    </button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {editingVariant && (
        <VariantEditModal
          product={product}
          variant={editingVariant}
          images={images}
          onImagesChange={onImagesChange}
          onClose={() => setEditingVariant(null)}
          onSaved={(updated, refreshedImages) =>
            onProductUpdate({
              ...product,
              ...(refreshedImages ? { images: refreshedImages } : {}),
              variants: product.variants.map((v) => (v.id === updated.id ? updated : v)),
            })
          }
        />
      )}
    </Card>
  );
}
