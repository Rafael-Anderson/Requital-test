"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, GripVertical, MousePointerClick, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deleteBioLink,
  getBioPageConfig,
  listBioLinks,
  listCategories,
  listCollections,
  listProducts,
  reorderBioLinks,
  resolveImageUrl,
  updateBioLink,
  updateBioPageConfig,
  uploadBioLinkImage,
} from "@/lib/api";
import {
  BIO_LINK_TYPE_LABELS,
  type BioLink,
  type BioPageConfig,
  type Category,
  type Collection,
  type Product,
} from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ImageDropzone from "@/components/ui/ImageDropzone";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { TableSkeleton, CardSkeleton } from "@/components/ui/Skeleton";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import BioLinkFormModal from "@/components/BioLinkFormModal";
import PageShell from "@/components/ui/PageShell";

const TYPE_BADGE_CLASS =
  "inline-flex items-center rounded-full border border-black/10 dark:border-white/10 px-2 py-0.5 text-xs text-zinc-500";

// Logo/background upload widgets mirror Theme's own (ImageDropzone,
// preview + "Change image" on click/drop) — plus an explicit Remove button,
// which Theme's own usage doesn't have but this page needs: clearing a
// bio-specific override is how a merchant goes back to inheriting Theme's
// logo/banner, a real and distinct action here (see storefront
// lib/bio-page.ts's fallback chain), not just cosmetic tidying.
function BioPageConfigCard() {
  const toast = useToast();
  const [config, setConfig] = useState<BioPageConfig | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const [backgroundRemoved, setBackgroundRemoved] = useState(false);
  const [description, setDescription] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getBioPageConfig().then((c) => {
      setConfig(c);
      setLogoPreview(resolveImageUrl(c.logoUrl));
      setBackgroundPreview(resolveImageUrl(c.backgroundUrl));
      setDescription(c.description ?? "");
      setMetaTitle(c.metaTitle ?? "");
      setMetaDescription(c.metaDescription ?? "");
    });
  }, []);

  function handleLogoSelected(file: File) {
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setLogoRemoved(false);
  }
  function handleBackgroundSelected(file: File) {
    setBackgroundFile(file);
    setBackgroundPreview(URL.createObjectURL(file));
    setBackgroundRemoved(false);
  }
  function handleRemoveLogo() {
    setLogoFile(null);
    setLogoPreview(null);
    setLogoRemoved(true);
  }
  function handleRemoveBackground() {
    setBackgroundFile(null);
    setBackgroundPreview(null);
    setBackgroundRemoved(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // undefined = leave untouched (Prisma skips it in the upsert data);
      // null = explicitly clear, back to inheriting Theme's logo/banner —
      // see UpdateBioPageConfigDto's comment on why both are meaningful here.
      const logoUrl = logoFile ? (await uploadBioLinkImage(logoFile)).url : logoRemoved ? null : undefined;
      const backgroundUrl = backgroundFile
        ? (await uploadBioLinkImage(backgroundFile)).url
        : backgroundRemoved
          ? null
          : undefined;
      const saved = await updateBioPageConfig({
        logoUrl,
        backgroundUrl,
        description: description || undefined,
        metaTitle: metaTitle || undefined,
        metaDescription: metaDescription || undefined,
      });
      setConfig(saved);
      setLogoFile(null);
      setBackgroundFile(null);
      setLogoRemoved(false);
      setBackgroundRemoved(false);
      toast("Bio page settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save bio page settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!config) return <CardSkeleton />;

  return (
    <Card className="space-y-4">
      <h2 className="text-sm font-semibold">Bio page settings</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <ImageDropzone label="Logo" preview={logoPreview} onFileSelected={handleLogoSelected} />
          {logoPreview && (
            <button
              type="button"
              onClick={handleRemoveLogo}
              className="mt-1.5 flex items-center gap-1 text-xs text-zinc-500 hover:text-red-600 transition-colors cursor-pointer"
            >
              <X className="size-3" />
              Remove logo
            </button>
          )}
          <p className="mt-1.5 text-xs text-zinc-400">Falls back to your Theme logo if left unset.</p>
        </div>

        <div>
          <ImageDropzone label="Background image" preview={backgroundPreview} onFileSelected={handleBackgroundSelected} />
          {backgroundPreview && (
            <button
              type="button"
              onClick={handleRemoveBackground}
              className="mt-1.5 flex items-center gap-1 text-xs text-zinc-500 hover:text-red-600 transition-colors cursor-pointer"
            >
              <X className="size-3" />
              Remove background
            </button>
          )}
          <p className="mt-1.5 text-xs text-zinc-400">
            Falls back to your Theme banner if left unset — your accent color shows through if neither is set.
          </p>
        </div>
      </div>

      <Textarea
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="A short line shown under your logo on the bio page"
      />

      <div>
        <Input
          label="Meta title"
          value={metaTitle}
          onChange={(e) => setMetaTitle(e.target.value)}
          placeholder="Your Shop Name — Bio Links"
          maxLength={255}
        />
        <p className="mt-1.5 text-xs text-zinc-400">
          Shown in browser tabs and search results for your bio page. Falls back to your shop&apos;s general SEO
          title if left blank.
        </p>
      </div>

      <div>
        <Textarea
          label="Meta description"
          value={metaDescription}
          onChange={(e) => setMetaDescription(e.target.value)}
          placeholder="All our links in one place."
          maxLength={500}
        />
        <p className="mt-1.5 text-xs text-zinc-400">
          Shown under the title in search results and link previews. Falls back to your shop&apos;s general SEO
          description if left blank.
        </p>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          <Check className="size-4 inline -mt-0.5 mr-1" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Card>
  );
}

export default function BioLinksPage() {
  const [bioLinks, setBioLinks] = useState<BioLink[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BioLink | null>(null);
  const [creating, setCreating] = useState(false);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const toast = useToast();
  const deleteWithUndo = useUndoableDelete();

  const refresh = useCallback(async () => {
    try {
      setBioLinks(await listBioLinks());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bio links");
    }
  }, []);

  useEffect(() => {
    refresh();
    listProducts().then(setProducts).catch(() => setProducts([]));
    listCategories().then(setCategories).catch(() => setCategories([]));
    listCollections().then(setCollections).catch(() => setCollections([]));
  }, [refresh]);

  function handleDelete(link: BioLink) {
    deleteWithUndo({
      id: link.id,
      label: `"${link.label}"`,
      onRemoveLocally: () => setBioLinks((prev) => (prev ? prev.filter((l) => l.id !== link.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteBioLink(link.id),
    });
  }

  async function handleToggleActive(link: BioLink, next: boolean) {
    setBioLinks((prev) => prev?.map((l) => (l.id === link.id ? { ...l, active: next } : l)) ?? prev);
    try {
      await updateBioLink(link.id, { active: next });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update link", "error");
      refresh();
    }
  }

  // Native HTML5 drag-and-drop — no drag library exists anywhere else in
  // this app (confirmed before building this), and this is the one place
  // that needs true drag reordering rather than the numeric-order-input
  // pattern Categories uses, so it's not reusing an existing UI either way.
  function handleDrop(targetId: number) {
    if (draggedId === null || draggedId === targetId || !bioLinks) {
      setDraggedId(null);
      return;
    }
    const fromIndex = bioLinks.findIndex((l) => l.id === draggedId);
    const toIndex = bioLinks.findIndex((l) => l.id === targetId);
    const reordered = [...bioLinks];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setBioLinks(reordered);
    setDraggedId(null);
    reorderBioLinks(reordered.map((l) => l.id)).catch((err) => {
      toast(err instanceof Error ? err.message : "Failed to save new order", "error");
      refresh();
    });
  }

  return (
    <PageShell>
      <BackButton href="/" />
      <h1 className="text-2xl font-semibold mb-1">Bio Links</h1>
      <p className="text-sm text-zinc-500 mb-4">
        A shareable link-in-bio page for your storefront — drag rows to reorder them.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <BioPageConfigCard />

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Links</h2>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4 inline -mt-0.5 mr-1" />
              Add link
            </Button>
          </div>

          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

          <div className="rounded-lg border dark:border-white/10 overflow-hidden">
            {bioLinks === null ? (
              <TableSkeleton rows={4} cols={3} />
            ) : bioLinks.length === 0 ? (
              <EmptyState title="No bio links yet" description="Add a link to start building your bio page." />
            ) : (
              <div className="divide-y divide-black/5 dark:divide-white/10">
                {bioLinks.map((link) => (
                  <div
                    key={link.id}
                    draggable
                    onDragStart={() => setDraggedId(link.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(link.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors ${
                      draggedId === link.id ? "opacity-40" : ""
                    }`}
                  >
                    <span className="cursor-grab active:cursor-grabbing text-zinc-400 shrink-0" aria-hidden>
                      <GripVertical className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{link.label}</span>
                        <span className={TYPE_BADGE_CLASS}>{BIO_LINK_TYPE_LABELS[link.type]}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-zinc-400 mt-0.5">
                        <MousePointerClick className="size-3" />
                        {link.clickCount} click{link.clickCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <Toggle checked={link.active} onChange={(next) => handleToggleActive(link, next)} />
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => setEditing(link)}
                        className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        aria-label={`Edit ${link.label}`}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(link)}
                        className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                        aria-label={`Delete ${link.label}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {(creating || editing) && (
        <BioLinkFormModal
          bioLink={editing}
          products={products}
          categories={categories}
          collections={collections}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}
