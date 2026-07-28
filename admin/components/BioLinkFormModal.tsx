"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { createBioLink, updateBioLink, type BioLinkInput } from "@/lib/api";
import {
  BIO_LINK_SOCIAL_PLATFORMS,
  BIO_LINK_SOCIAL_PLATFORM_LABELS,
  BIO_LINK_TYPES,
  BIO_LINK_TYPE_LABELS,
  type BioLink,
  type BioLinkSocialPlatform,
  type BioLinkType,
  type Category,
  type Collection,
  type Product,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

// Product/category pickers are plain <select> dropdowns, matching
// CategoryFormModal's own parent-category select exactly — there's no
// searchable/modal picker component anywhere else in this app to reuse
// instead (confirmed before building this). Flag if the catalog ever grows
// large enough that a flat dropdown becomes unusable — that would be new UI,
// not reuse of anything existing.
export default function BioLinkFormModal({
  bioLink,
  products,
  categories,
  collections,
  onClose,
  onSaved,
}: {
  bioLink: BioLink | null;
  products: Product[];
  categories: Category[];
  collections: Collection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<BioLinkType>(bioLink?.type ?? "EXTERNAL_URL");
  const [label, setLabel] = useState(bioLink?.label ?? "");
  const [url, setUrl] = useState(bioLink?.url ?? "");
  const [productId, setProductId] = useState(bioLink?.productId != null ? String(bioLink.productId) : "");
  const [categoryId, setCategoryId] = useState(bioLink?.categoryId != null ? String(bioLink.categoryId) : "");
  const [collectionId, setCollectionId] = useState(
    bioLink?.collectionId != null ? String(bioLink.collectionId) : "",
  );
  const [socialPlatform, setSocialPlatform] = useState<BioLinkSocialPlatform>(
    bioLink?.socialPlatform ?? "instagram",
  );
  const [active, setActive] = useState(bioLink?.active ?? true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function targetValid(): boolean {
    if (type === "EXTERNAL_URL") return !!url.trim();
    if (type === "PRODUCT") return productId !== "";
    if (type === "CATEGORY") return categoryId !== "";
    if (type === "COLLECTION") return collectionId !== "";
    return true; // SOCIAL_ICON always has a platform selected (dropdown default)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (type !== "SOCIAL_ICON" && !label.trim()) return;
    if (!targetValid()) return;

    setSaving(true);
    try {
      const payload: BioLinkInput = {
        type,
        label: label.trim() || undefined,
        ...(type === "EXTERNAL_URL" && { url: url.trim() }),
        ...(type === "PRODUCT" && { productId: Number(productId) }),
        ...(type === "CATEGORY" && { categoryId: Number(categoryId) }),
        ...(type === "COLLECTION" && { collectionId: Number(collectionId) }),
        ...(type === "SOCIAL_ICON" && { socialPlatform }),
      };
      if (bioLink) {
        await updateBioLink(bioLink.id, { ...payload, active });
        toast(`"${label || BIO_LINK_TYPE_LABELS[type]}" updated`);
      } else {
        await createBioLink(payload);
        toast(`"${label || BIO_LINK_TYPE_LABELS[type]}" added`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save link", "error");
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

        <h2 className="text-lg font-semibold mb-4">{bioLink ? "Edit link" : "Add link"}</h2>

        <div className="space-y-3.5">
          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as BioLinkType)} className={SELECT_CLASS}>
              {BIO_LINK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BIO_LINK_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <Input
            label={type === "SOCIAL_ICON" ? "Label (optional)" : "Label"}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={type === "SOCIAL_ICON" ? BIO_LINK_SOCIAL_PLATFORM_LABELS[socialPlatform] : undefined}
            required={type !== "SOCIAL_ICON"}
          />

          {type === "EXTERNAL_URL" && (
            <Input label="URL" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} required />
          )}

          {type === "PRODUCT" && (
            <div>
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Product</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className={SELECT_CLASS} required>
                <option value="">Select a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {type === "CATEGORY" && (
            <div>
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Category</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={SELECT_CLASS} required>
                <option value="">Select a category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {type === "COLLECTION" && (
            <div>
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Collection</label>
              <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} className={SELECT_CLASS} required>
                <option value="">Select a collection…</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {type === "SOCIAL_ICON" && (
            <div>
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Platform</label>
              <select
                value={socialPlatform}
                onChange={(e) => setSocialPlatform(e.target.value as BioLinkSocialPlatform)}
                className={SELECT_CLASS}
              >
                {BIO_LINK_SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {BIO_LINK_SOCIAL_PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-zinc-400 mt-1.5">
                Uses the URL already set for this platform on Online Presence (or your WhatsApp number for
                WhatsApp) — nothing more to enter here. The icon won&apos;t appear on your bio page until that&apos;s
                configured.
              </p>
            </div>
          )}

          {bioLink && (
            <div className="flex items-center gap-2">
              <Toggle checked={active} onChange={setActive} />
              <span className="text-sm">Active</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {bioLink ? "Save changes" : "Add link"}
          </Button>
        </div>
      </form>
    </div>
  );
}
