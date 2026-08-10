"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  createTemplate,
  deleteTemplate,
  listCollections,
  listProducts,
  setTemplateCollections,
  setTemplateProducts,
  updateTemplate,
  uploadTemplateImage,
  resolveImageUrl,
} from "@/lib/api";
import {
  TEMPLATE_TYPES,
  TEMPLATE_TYPE_LABELS,
  type Collection,
  type Template,
  type TemplateType,
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
import Combobox from "@/components/ui/Combobox";
import Tooltip from "@/components/ui/Tooltip";

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

interface WorkingCollectionMember {
  collectionId: number;
  collectionName: string;
  sortOrder: number;
}

// Shared by /products/templates/new and /products/templates/[id]/edit — same "prop
// optional = create vs edit" pattern as ProductForm. MANUAL's product list
// is a numeric-order-input table (Collections' own reorder convention), not
// native drag-and-drop (that stays Bio Links' one special case — see its
// own comment on why it doesn't reuse anywhere else).
export default function TemplateForm({ template: initial }: { template?: Template }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!initial;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(resolveImageUrl(initial?.image ?? null));
  const [type, setType] = useState<TemplateType>(initial?.type ?? "MANUAL");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [displayOrder, setDisplayOrder] = useState(String(initial?.displayOrder ?? 0));

  const [collectionId, setCollectionId] = useState(initial?.rules?.collectionId ? String(initial.rules.collectionId) : "");
  const [tagName, setTagName] = useState(initial?.rules?.tagName ?? "");
  const [minPrice, setMinPrice] = useState(initial?.rules?.minPrice !== undefined ? String(initial.rules.minPrice) : "");
  const [maxPrice, setMaxPrice] = useState(initial?.rules?.maxPrice !== undefined ? String(initial.rules.maxPrice) : "");
  const [createdWithinDays, setCreatedWithinDays] = useState(
    initial?.rules?.createdWithinDays !== undefined ? String(initial.rules.createdWithinDays) : "",
  );

  const [collections, setCollections] = useState<Collection[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [members, setMembers] = useState<WorkingMember[]>([]);
  const [addProductId, setAddProductId] = useState("");
  const [collectionMembers, setCollectionMembers] = useState<WorkingCollectionMember[]>([]);
  const [addCollectionId, setAddCollectionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    listCollections().then(setCollections).catch(() => setCollections([]));
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

  // Same "resolve once collections load" pattern as the product-members
  // effect above, for COLLECTION_GROUP's own membership list.
  useEffect(() => {
    if (!initial?.collections || collections.length === 0) return;
    setCollectionMembers((prev) =>
      prev.length > 0
        ? prev
        : initial.collections!.map((c) => ({
            collectionId: c.collectionId,
            collectionName: collections.find((col) => col.id === c.collectionId)?.name ?? `Collection ${c.collectionId}`,
            sortOrder: c.sortOrder,
          })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections]);

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
      toast("That product is already in this template", "error");
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

  function handleAddCollectionMember() {
    const collection = collections.find((c) => c.id === Number(addCollectionId));
    if (!collection) return;
    if (collectionMembers.some((m) => m.collectionId === collection.id)) {
      toast("That collection is already in this template", "error");
      return;
    }
    setCollectionMembers((prev) => [
      ...prev,
      { collectionId: collection.id, collectionName: collection.name, sortOrder: prev.length },
    ]);
    setAddCollectionId("");
  }

  function updateCollectionMemberOrder(collectionId: number, sortOrder: number) {
    setCollectionMembers((prev) => prev.map((m) => (m.collectionId === collectionId ? { ...m, sortOrder } : m)));
  }

  function removeCollectionMember(collectionId: number) {
    setCollectionMembers((prev) => prev.filter((m) => m.collectionId !== collectionId));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !slug.trim()) return;
    if (type === "RULE_BASED" && !collectionId && !tagName.trim() && !minPrice && !maxPrice && !createdWithinDays) {
      toast("A rule-based template needs at least one condition set", "error");
      return;
    }
    setSaving(true);
    try {
      let image: string | undefined;
      if (imageFile) {
        const uploaded = await uploadTemplateImage(imageFile);
        image = uploaded.url;
      }
      const rules =
        type === "RULE_BASED"
          ? {
              ...(collectionId && { collectionId: Number(collectionId) }),
              ...(tagName.trim() && { tagName: tagName.trim() }),
              ...(minPrice && { minPrice: Number(minPrice) }),
              ...(maxPrice && { maxPrice: Number(maxPrice) }),
              ...(createdWithinDays && { createdWithinDays: Number(createdWithinDays) }),
            }
          : undefined;

      let saved: Template;
      if (isEdit && initial) {
        saved = await updateTemplate(initial.id, {
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
        saved = await createTemplate({
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
        await setTemplateProducts(
          saved.id,
          members.map((m) => ({ productId: m.productId, sortOrder: m.sortOrder })),
        );
      } else if (type === "COLLECTION_GROUP") {
        await setTemplateCollections(
          saved.id,
          collectionMembers.map((m) => ({ collectionId: m.collectionId, sortOrder: m.sortOrder })),
        );
      }

      router.push("/products/templates");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save template", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    if (!confirm(`Delete "${initial.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteTemplate(initial.id);
      toast(`"${initial.title}" deleted`);
      router.push("/products/templates");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete template", "error");
      setDeleting(false);
    }
  }

  return (
    <PageShell>
      <BackButton href="/products/templates" />
      <form onSubmit={handleSubmit} className="max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{isEdit ? `Edit "${initial!.title}"` : "New template"}</h1>
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
          <Combobox
            label="Type"
            value={type}
            onChange={(v) => setType(v as TemplateType)}
            options={TEMPLATE_TYPES.map((t) => ({ value: t, label: TEMPLATE_TYPE_LABELS[t] }))}
          />

          {type === "RULE_BASED" ? (
            <div className="space-y-3.5">
              <p className="text-xs text-zinc-500">
                Products matching every condition set below are included automatically. Leave a condition blank to
                ignore it.
              </p>
              <Combobox
                label="Collection"
                value={collectionId}
                onChange={setCollectionId}
                placeholder="Any collection"
                options={[
                  { value: "", label: "Any collection" },
                  ...collections.map((c) => ({ value: String(c.id), label: c.name })),
                ]}
              />
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
          ) : type === "COLLECTION_GROUP" ? (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">
                The products from every Collection listed below are shown together in this Template&apos;s storefront
                homepage section.
              </p>
              <Table>
                <THead>
                  <tr>
                    <TH>Collection</TH>
                    <TH className="w-24">Order</TH>
                    <TH className="w-10"></TH>
                  </tr>
                </THead>
                <TBody>
                  {collectionMembers.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-3 text-sm text-zinc-400">
                        No collections added yet.
                      </td>
                    </tr>
                  ) : (
                    [...collectionMembers]
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((m) => (
                        <TR key={m.collectionId}>
                          <TD>{m.collectionName}</TD>
                          <TD>
                            <input
                              type="number"
                              value={m.sortOrder}
                              onChange={(e) => updateCollectionMemberOrder(m.collectionId, Number(e.target.value) || 0)}
                              className="w-16 border border-black/15 dark:border-white/15 rounded px-2 py-1 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
                            />
                          </TD>
                          <TD>
                            <Tooltip label={`Remove ${m.collectionName} from this template`}>
                              <button
                                type="button"
                                onClick={() => removeCollectionMember(m.collectionId)}
                                aria-label={`Remove ${m.collectionName}`}
                                className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </Tooltip>
                          </TD>
                        </TR>
                      ))
                  )}
                </TBody>
              </Table>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Combobox
                    label="Add collection"
                    value={addCollectionId}
                    onChange={setAddCollectionId}
                    placeholder="Select a collection…"
                    options={collections.map((c) => ({ value: String(c.id), label: c.name }))}
                  />
                </div>
                <Button type="button" variant="secondary" onClick={handleAddCollectionMember} disabled={!addCollectionId}>
                  <Plus className="size-4 inline -mt-0.5 mr-1" />
                  Add
                </Button>
              </div>
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
                              className="w-16 border border-black/15 dark:border-white/15 rounded px-2 py-1 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
                            />
                          </TD>
                          <TD>
                            <Tooltip label={`Remove ${m.productName} from this template`}>
                              <button
                                type="button"
                                onClick={() => removeMember(m.productId)}
                                aria-label={`Remove ${m.productName}`}
                                className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </Tooltip>
                          </TD>
                        </TR>
                      ))
                  )}
                </TBody>
              </Table>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Combobox
                    label="Add product"
                    value={addProductId}
                    onChange={setAddProductId}
                    placeholder="Select a product…"
                    options={products.map((p) => ({ value: String(p.id), label: p.name }))}
                  />
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
          <Button type="button" variant="secondary" onClick={() => router.push("/products/templates")}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create template"}
          </Button>
        </div>
      </form>
    </PageShell>
  );
}
