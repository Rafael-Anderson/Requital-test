"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  createCollection,
  deleteCollection,
  listCategories,
  listProducts,
  setCollectionProducts,
  updateCollection,
  uploadCollectionImage,
  resolveImageUrl,
} from "@/lib/api";
import {
  COLLECTION_TYPES,
  COLLECTION_TYPE_LABELS,
  type Category,
  type Collection,
  type CollectionType,
  type Product,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Toggle from "@/components/ui/Toggle";
import Card from "@/components/ui/Card";
import PageShell from "@/components/ui/PageShell";
import BackButton from "@/components/ui/BackButton";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface WorkingMember {
  productId: number;
  productName: string;
  sortOrder: number;
}

// Shared by /collections/new and /collections/[id]/edit — same "prop
// optional = create vs edit" pattern as ProductForm. MANUAL's product list
// is a numeric-order-input table (Categories' own reorder convention), not
// native drag-and-drop (that stays Bio Links' one special case — see its
// own comment on why it doesn't reuse anywhere else).
export default function CollectionForm({ collection: initial }: { collection?: Collection }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!initial;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(resolveImageUrl(initial?.image ?? null));
  const [type, setType] = useState<CollectionType>(initial?.type ?? "MANUAL");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [displayOrder, setDisplayOrder] = useState(String(initial?.displayOrder ?? 0));

  const [categoryId, setCategoryId] = useState(initial?.rules?.categoryId ? String(initial.rules.categoryId) : "");
  const [tagName, setTagName] = useState(initial?.rules?.tagName ?? "");
  const [minPrice, setMinPrice] = useState(initial?.rules?.minPrice !== undefined ? String(initial.rules.minPrice) : "");
  const [maxPrice, setMaxPrice] = useState(initial?.rules?.maxPrice !== undefined ? String(initial.rules.maxPrice) : "");
  const [createdWithinDays, setCreatedWithinDays] = useState(
    initial?.rules?.createdWithinDays !== undefined ? String(initial.rules.createdWithinDays) : "",
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [members, setMembers] = useState<WorkingMember[]>([]);
  const [addProductId, setAddProductId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => setCategories([]));
    listProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  // Manual membership needs each id resolved to a display name — fetched
  // once products load, not blocking the rest of the form on it.
  useEffect(() => {
    if (!initial?.productIds || products.length === 0) return;
    setMembers((prev) =>
      prev.length > 0
        ? prev
        : initial.productIds!.map((id, i) => ({
            productId: id,
            productName: products.find((p) => p.id === id)?.name ?? `Product ${id}`,
            sortOrder: i,
          })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  function handleFileSelected(file: File) {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function handleAddMember() {
    const product = products.find((p) => p.id === Number(addProductId));
    if (!product) return;
    if (members.some((m) => m.productId === product.id)) {
      toast("That product is already in this collection", "error");
      return;
    }
    setMembers((prev) => [...prev, { productId: product.id, productName: product.name, sortOrder: prev.length }]);
    setAddProductId("");
  }

  function updateMemberOrder(productId: number, sortOrder: number) {
    setMembers((prev) => prev.map((m) => (m.productId === productId ? { ...m, sortOrder } : m)));
  }

  function removeMember(productId: number) {
    setMembers((prev) => prev.filter((m) => m.productId !== productId));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !slug.trim()) return;
    if (type === "RULE_BASED" && !categoryId && !tagName.trim() && !minPrice && !maxPrice && !createdWithinDays) {
      toast("A rule-based collection needs at least one condition set", "error");
      return;
    }
    setSaving(true);
    try {
      let image: string | undefined;
      if (imageFile) {
        const uploaded = await uploadCollectionImage(imageFile);
        image = uploaded.url;
      }
      const rules =
        type === "RULE_BASED"
          ? {
              ...(categoryId && { categoryId: Number(categoryId) }),
              ...(tagName.trim() && { tagName: tagName.trim() }),
              ...(minPrice && { minPrice: Number(minPrice) }),
              ...(maxPrice && { maxPrice: Number(maxPrice) }),
              ...(createdWithinDays && { createdWithinDays: Number(createdWithinDays) }),
            }
          : undefined;

      let saved: Collection;
      if (isEdit && initial) {
        saved = await updateCollection(initial.id, {
          title,
          slug,
          description: description || undefined,
          type,
          rules,
          isActive,
          displayOrder: Number(displayOrder) || 0,
          ...(image !== undefined && { image }),
        });
        toast(`"${title}" updated`);
      } else {
        saved = await createCollection({
          title,
          slug,
          description: description || undefined,
          image,
          type,
          rules,
          isActive,
          displayOrder: Number(displayOrder) || 0,
        });
        toast(`"${title}" created`);
      }

      if (type === "MANUAL") {
        await setCollectionProducts(
          saved.id,
          members.map((m) => ({ productId: m.productId, sortOrder: m.sortOrder })),
        );
      }

      router.push("/collections");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save collection", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    if (!confirm(`Delete "${initial.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteCollection(initial.id);
      toast(`"${initial.title}" deleted`);
      router.push("/collections");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete collection", "error");
      setDeleting(false);
    }
  }

  return (
    <PageShell>
      <BackButton href="/collections" />
      <form onSubmit={handleSubmit} className="max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{isEdit ? `Edit "${initial!.title}"` : "New collection"}</h1>
          {isEdit && (
            <Button type="button" variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>

        <Card className="space-y-3.5">
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Input
            label="Slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            required
          />
          <Textarea label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          <ImageDropzone preview={imagePreview} onFileSelected={handleFileSelected} />
          <div className="flex items-center gap-2">
            <Toggle checked={isActive} onChange={setIsActive} />
            <span className="text-sm">Active (visible on the storefront)</span>
          </div>
          <Input
            label="Display order"
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />
        </Card>

        <Card className="space-y-3.5">
          <h3 className="text-sm font-semibold">Membership</h3>
          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as CollectionType)} className={SELECT_CLASS}>
              {COLLECTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COLLECTION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {type === "RULE_BASED" ? (
            <div className="space-y-3.5">
              <p className="text-xs text-zinc-500">
                Products matching every condition set below are included automatically — leave a condition blank to
                ignore it.
              </p>
              <div>
                <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Category</label>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={SELECT_CLASS}>
                  <option value="">Any category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <Input label="Tag (optional)" value={tagName} onChange={(e) => setTagName(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Min price (optional)" type="number" min="0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
                <Input label="Max price (optional)" type="number" min="0" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
              </div>
              <Input
                label="Created within days (optional)"
                type="number"
                min="1"
                value={createdWithinDays}
                onChange={(e) => setCreatedWithinDays(e.target.value)}
                placeholder="e.g. 30 for 'New Arrivals'"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <Table>
                <THead>
                  <tr>
                    <TH>Product</TH>
                    <TH className="w-24">Order</TH>
                    <TH className="w-10"></TH>
                  </tr>
                </THead>
                <TBody>
                  {members.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-3 text-sm text-zinc-400">
                        No products added yet.
                      </td>
                    </tr>
                  ) : (
                    [...members]
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((m) => (
                        <TR key={m.productId}>
                          <TD>{m.productName}</TD>
                          <TD>
                            <input
                              type="number"
                              value={m.sortOrder}
                              onChange={(e) => updateMemberOrder(m.productId, Number(e.target.value) || 0)}
                              className="w-16 border rounded px-2 py-1 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
                            />
                          </TD>
                          <TD>
                            <button
                              type="button"
                              onClick={() => removeMember(m.productId)}
                              aria-label={`Remove ${m.productName}`}
                              className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </TD>
                        </TR>
                      ))
                  )}
                </TBody>
              </Table>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Add product</label>
                  <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} className={SELECT_CLASS}>
                    <option value="">Select a product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="button" variant="secondary" onClick={handleAddMember} disabled={!addProductId}>
                  <Plus className="size-4 inline -mt-0.5 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          )}
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.push("/collections")}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create collection"}
          </Button>
        </div>
      </form>
    </PageShell>
  );
}
