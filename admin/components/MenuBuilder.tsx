"use client";

import { useEffect, useState } from "react";
import { GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  createMenuItem,
  deleteMenuItem,
  listCollections,
  listMenuItems,
  listProducts,
  reorderMenuItems,
  updateMenuItem,
  type MenuColumnInput,
  type MenuColumnLinkInput,
} from "@/lib/api";
import {
  MENU_ITEM_TYPES,
  type Collection,
  type MenuColumnLinkType,
  type MenuItem,
  type MenuItemStyle,
  type MenuItemType,
  type Product,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Combobox from "@/components/ui/Combobox";
import Checkbox from "@/components/ui/Checkbox";
import Select from "@/components/ui/Select";
import ColorPicker from "@/components/ui/ColorPicker";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import { useToast } from "@/components/ui/Toast";
import Tooltip from "@/components/ui/Tooltip";

interface DraftCollection {
  collectionId: number;
  name: string;
}

interface DraftLink {
  label: string;
  linkType: MenuColumnLinkType;
  collectionId?: number;
  productId?: number;
  customUrl?: string;
  featured: boolean;
}

interface DraftColumn {
  title: string;
  links: DraftLink[];
}

const TYPE_LABELS: Record<MenuItemType, string> = { LINK: "Link", DROPDOWN: "Dropdown", MEGA: "Mega menu" };

// A single link row inside a mega menu column — target type toggle
// (collection / product / custom URL, same discriminated-fields shape the
// backend enforces) plus the featured checkbox. Kept collapsed to
// label + target summary once filled in; editing re-expands it.
function MegaLinkEditor({
  link,
  collections,
  products,
  onChange,
  onRemove,
}: {
  link: DraftLink;
  collections: Collection[];
  products: Product[];
  onChange: (patch: Partial<DraftLink>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-border dark:border-white/10 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          label="Link label"
          value={link.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="flex-1"
        />
        <Tooltip label="Remove link">
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove link"
            className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer shrink-0"
          >
            <X className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <SegmentedToggle
        value={link.linkType}
        options={[
          { value: "COLLECTION", label: "Collection" },
          { value: "PRODUCT", label: "Product" },
          { value: "CUSTOM", label: "Custom URL" },
        ]}
        onChange={(v) => onChange({ linkType: v as MenuColumnLinkType, collectionId: undefined, productId: undefined, customUrl: undefined })}
      />
      {link.linkType === "COLLECTION" && (
        <Combobox
          value={link.collectionId != null ? String(link.collectionId) : ""}
          onChange={(v) => onChange({ collectionId: v ? Number(v) : undefined })}
          placeholder="Select a collection…"
          options={collections.map((c) => ({ value: String(c.id), label: c.name }))}
        />
      )}
      {link.linkType === "PRODUCT" && (
        <Combobox
          value={link.productId != null ? String(link.productId) : ""}
          onChange={(v) => onChange({ productId: v ? Number(v) : undefined })}
          placeholder="Select a product…"
          options={products.map((p) => ({ value: String(p.id), label: p.name }))}
        />
      )}
      {link.linkType === "CUSTOM" && (
        <Input label="Custom URL" placeholder="https://…" value={link.customUrl ?? ""} onChange={(e) => onChange({ customUrl: e.target.value })} />
      )}
      <Checkbox
        label="Featured (renders in accent color)"
        checked={link.featured}
        onChange={(e) => onChange({ featured: e.target.checked })}
      />
    </div>
  );
}

// One named column of a mega menu item — a title plus an ordered list of
// links. Column reordering is native-HTML5 drag (matching the top-level
// menu-item row pattern this file already uses); links inside a column are
// insertion-order add/remove only, matching the existing DROPDOWN
// collections list's own convention (no drag for a small nested list).
function MegaColumnEditor({
  column,
  index,
  collections,
  products,
  draggedIndex,
  onDragStart,
  onDrop,
  onTitleChange,
  onRemoveColumn,
  onAddLink,
  onChangeLink,
  onRemoveLink,
}: {
  column: DraftColumn;
  index: number;
  collections: Collection[];
  products: Product[];
  draggedIndex: number | null;
  onDragStart: () => void;
  onDrop: () => void;
  onTitleChange: (title: string) => void;
  onRemoveColumn: () => void;
  onAddLink: () => void;
  onChangeLink: (linkIndex: number, patch: Partial<DraftLink>) => void;
  onRemoveLink: (linkIndex: number) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={`rounded-lg border border-border dark:border-white/10 p-3 space-y-2 ${draggedIndex === index ? "opacity-40" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="cursor-grab active:cursor-grabbing text-text-faint shrink-0" aria-hidden>
          <GripVertical className="size-4" />
        </span>
        <Input label="Column title" value={column.title} onChange={(e) => onTitleChange(e.target.value)} wrapperClassName="flex-1" />
        <Tooltip label="Remove column" align="end">
          <button
            type="button"
            onClick={onRemoveColumn}
            aria-label="Remove column"
            className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer shrink-0"
          >
            <Trash2 className="size-4" />
          </button>
        </Tooltip>
      </div>
      <div className="space-y-2 pl-6">
        {column.links.map((link, linkIndex) => (
          <MegaLinkEditor
            key={linkIndex}
            link={link}
            collections={collections}
            products={products}
            onChange={(patch) => onChangeLink(linkIndex, patch)}
            onRemove={() => onRemoveLink(linkIndex)}
          />
        ))}
        <Button type="button" variant="secondary" onClick={onAddLink}>
          <Plus className="size-4 inline -mt-0.5 mr-1" />
          Add link
        </Button>
      </div>
    </div>
  );
}

// A color override that's optional (undefined = inherit the header's
// default styling) — ColorPicker itself always needs a concrete hex, so
// this defaults the swatch to a neutral placeholder and surfaces a "Reset"
// link only once a real override has been set, rather than forcing every
// nav item to carry an explicit color.
function ColorSwatchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="flex items-center gap-2">
        <ColorPicker value={value ?? "#000000"} onChange={onChange} swatchSize="sm" />
        {value && (
          <button type="button" onClick={() => onChange(undefined)} className="text-xs text-text-faint hover:text-red-600 cursor-pointer">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// The storefront top bar's merchant-configured nav (Phase C) — a merchant-
// ordered list of LINK (one Collection) / DROPDOWN (several Collections) /
// MEGA (named columns of links, storefront-v2) items. Each row is its own
// real create/update/delete call (no batching with the surrounding page's
// Save button, same "immediate persistence" convention Bio Links uses); row
// order persists via the same native-drag + dedicated /reorder-endpoint
// pattern as Bio Links/Collections. A Dropdown's own member-collection list
// and a Mega column's own link list are add/remove-ordered (insertion
// order, no drag) — small lists nested inside an already-open inline form,
// not worth a second drag surface. Columns themselves ARE draggable, same
// pattern as the top-level item rows.
export default function MenuBuilder() {
  const toast = useToast();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [draggedId, setDraggedId] = useState<number | null>(null);

  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<MenuItemType>("LINK");
  const [linkCollectionId, setLinkCollectionId] = useState("");
  const [dropdownCollections, setDropdownCollections] = useState<DraftCollection[]>([]);
  const [addDropdownCollectionId, setAddDropdownCollectionId] = useState("");
  const [draftColumns, setDraftColumns] = useState<DraftColumn[]>([]);
  const [draggedColumnIndex, setDraggedColumnIndex] = useState<number | null>(null);
  const [draftStyle, setDraftStyle] = useState<MenuItemStyle>({});
  const [saving, setSaving] = useState(false);

  const refresh = () => listMenuItems().then(setItems).catch(() => setItems([]));

  useEffect(() => {
    refresh();
    listCollections().then(setCollections).catch(() => setCollections([]));
    listProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  function startCreate() {
    setEditingId("new");
    setLabel("");
    setType("LINK");
    setLinkCollectionId("");
    setDropdownCollections([]);
    setDraftColumns([]);
    setDraftStyle({});
  }

  function startEdit(item: MenuItem) {
    setEditingId(item.id);
    setLabel(item.label);
    setType(item.type);
    setLinkCollectionId(item.collectionId !== null ? String(item.collectionId) : "");
    setDropdownCollections(
      item.collections.map((c) => ({
        collectionId: c.collectionId,
        name: c.collection?.name ?? `Collection ${c.collectionId}`,
      })),
    );
    setDraftColumns(
      item.columns.map((col) => ({
        title: col.title,
        links: col.links.map((l) => ({
          label: l.label,
          linkType: l.linkType,
          collectionId: l.collection?.id,
          productId: l.product?.id,
          customUrl: l.customUrl ?? undefined,
          featured: l.featured,
        })),
      })),
    );
    setDraftStyle(item.style ?? {});
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function addDropdownCollection() {
    const collection = collections.find((c) => c.id === Number(addDropdownCollectionId));
    if (!collection) return;
    if (dropdownCollections.some((c) => c.collectionId === collection.id)) {
      toast("That collection is already in this dropdown", "error");
      return;
    }
    setDropdownCollections((prev) => [...prev, { collectionId: collection.id, name: collection.name }]);
    setAddDropdownCollectionId("");
  }

  function addColumn() {
    setDraftColumns((prev) => [...prev, { title: "", links: [] }]);
  }

  function removeColumn(index: number) {
    setDraftColumns((prev) => prev.filter((_, i) => i !== index));
  }

  function updateColumnTitle(index: number, title: string) {
    setDraftColumns((prev) => prev.map((c, i) => (i === index ? { ...c, title } : c)));
  }

  function handleColumnDrop(targetIndex: number) {
    if (draggedColumnIndex === null || draggedColumnIndex === targetIndex) {
      setDraggedColumnIndex(null);
      return;
    }
    setDraftColumns((prev) => {
      const reordered = [...prev];
      const [moved] = reordered.splice(draggedColumnIndex, 1);
      reordered.splice(targetIndex, 0, moved);
      return reordered;
    });
    setDraggedColumnIndex(null);
  }

  function addLink(columnIndex: number) {
    setDraftColumns((prev) =>
      prev.map((c, i) =>
        i === columnIndex ? { ...c, links: [...c.links, { label: "", linkType: "COLLECTION", featured: false }] } : c,
      ),
    );
  }

  function removeLink(columnIndex: number, linkIndex: number) {
    setDraftColumns((prev) =>
      prev.map((c, i) => (i === columnIndex ? { ...c, links: c.links.filter((_, li) => li !== linkIndex) } : c)),
    );
  }

  function changeLink(columnIndex: number, linkIndex: number, patch: Partial<DraftLink>) {
    setDraftColumns((prev) =>
      prev.map((c, i) =>
        i === columnIndex
          ? { ...c, links: c.links.map((l, li) => (li === linkIndex ? { ...l, ...patch } : l)) }
          : c,
      ),
    );
  }

  function validateColumns(): string | null {
    if (draftColumns.length === 0) return "Add at least one column";
    for (const col of draftColumns) {
      if (!col.title.trim()) return "Every column needs a title";
      if (col.links.length === 0) return `Column "${col.title || "Untitled"}" needs at least one link`;
      for (const link of col.links) {
        if (!link.label.trim()) return "Every link needs a label";
        if (link.linkType === "COLLECTION" && !link.collectionId) return `Pick a collection for "${link.label}"`;
        if (link.linkType === "PRODUCT" && !link.productId) return `Pick a product for "${link.label}"`;
        if (link.linkType === "CUSTOM" && !link.customUrl?.trim()) return `Enter a URL for "${link.label}"`;
      }
    }
    return null;
  }

  async function handleSave() {
    if (!label.trim()) {
      toast("Label is required", "error");
      return;
    }
    if (type === "LINK" && !linkCollectionId) {
      toast("Pick a collection for this link", "error");
      return;
    }
    if (type === "DROPDOWN" && dropdownCollections.length === 0) {
      toast("Add at least one collection to this dropdown", "error");
      return;
    }
    if (type === "MEGA") {
      const error = validateColumns();
      if (error) {
        toast(error, "error");
        return;
      }
    }
    setSaving(true);
    try {
      const columns: MenuColumnInput[] | undefined =
        type === "MEGA"
          ? draftColumns.map((col, colIndex) => ({
              title: col.title.trim(),
              sortOrder: colIndex,
              links: col.links.map((l, linkIndex): MenuColumnLinkInput => ({
                label: l.label.trim(),
                linkType: l.linkType,
                collectionId: l.linkType === "COLLECTION" ? l.collectionId : undefined,
                productId: l.linkType === "PRODUCT" ? l.productId : undefined,
                customUrl: l.linkType === "CUSTOM" ? l.customUrl?.trim() : undefined,
                featured: l.featured,
                sortOrder: linkIndex,
              })),
            }))
          : undefined;
      const data = {
        label: label.trim(),
        type,
        style: draftStyle,
        ...(type === "LINK" ? { collectionId: Number(linkCollectionId) } : {}),
        ...(type === "DROPDOWN"
          ? { collections: dropdownCollections.map((c, i) => ({ collectionId: c.collectionId, sortOrder: i })) }
          : {}),
        ...(type === "MEGA" ? { columns } : {}),
      };
      if (editingId === "new") {
        await createMenuItem(data);
        toast("Menu item added");
      } else if (editingId !== null) {
        await updateMenuItem(editingId, data);
        toast("Menu item updated");
      }
      setEditingId(null);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save menu item", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: MenuItem) {
    if (!confirm(`Remove "${item.label}" from the menu?`)) return;
    try {
      await deleteMenuItem(item.id);
      toast(`"${item.label}" removed`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to remove menu item", "error");
    }
  }

  // Native HTML5 drag-and-drop, same pattern as BioLinksPage/Collections.
  function handleDrop(targetId: number) {
    if (draggedId === null || draggedId === targetId || !items) {
      setDraggedId(null);
      return;
    }
    const fromIndex = items.findIndex((i) => i.id === draggedId);
    const toIndex = items.findIndex((i) => i.id === targetId);
    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setItems(reordered);
    setDraggedId(null);
    reorderMenuItems(reordered.map((i) => i.id)).catch((err) => {
      toast(err instanceof Error ? err.message : "Failed to save new order", "error");
      refresh();
    });
  }

  if (items === null) {
    return <p className="text-sm text-text-faint">Loading…</p>;
  }

  function itemSummary(item: MenuItem): string {
    if (item.type === "LINK") return item.collection?.name ?? "Link";
    if (item.type === "DROPDOWN") return `Dropdown · ${item.collections.length} collection${item.collections.length === 1 ? "" : "s"}`;
    return `Mega menu · ${item.columns.length} column${item.columns.length === 1 ? "" : "s"}`;
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && editingId === null ? (
        <p className="text-sm text-text-faint">No menu items yet. The storefront falls back to an automatic list of top-level collections.</p>
      ) : (
        <div className="rounded-lg border border-border dark:border-white/10 divide-y divide-black/5 dark:divide-white/10 overflow-hidden">
          {items.map((item) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => setDraggedId(item.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(item.id)}
              className={`flex items-center gap-2 px-3 py-2 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors ${
                draggedId === item.id ? "opacity-40" : ""
              }`}
            >
              <span className="cursor-grab active:cursor-grabbing text-text-faint shrink-0" aria-hidden>
                <GripVertical className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-text-faint ml-2 text-xs">{itemSummary(item)}</span>
              </div>
              <div className="flex gap-1 shrink-0">
                <Tooltip label={`Edit ${item.label}`}>
                  <button
                    onClick={() => startEdit(item)}
                    className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    aria-label={`Edit ${item.label}`}
                  >
                    <Pencil className="size-4" />
                  </button>
                </Tooltip>
                <Tooltip label={`Remove ${item.label} from the menu`} align="end">
                  <button
                    onClick={() => handleDelete(item)}
                    className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                    aria-label={`Remove ${item.label}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingId !== null ? (
        <div className="rounded-lg border border-border dark:border-white/10 p-3 space-y-3">
          <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <SegmentedToggle
            value={type}
            options={MENU_ITEM_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
            onChange={setType}
          />

          <div className="space-y-3 rounded-lg border border-border dark:border-white/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Style</p>
            <div className="grid grid-cols-2 gap-3">
              <ColorSwatchField label="Text color" value={draftStyle.textColor} onChange={(v) => setDraftStyle((s) => ({ ...s, textColor: v }))} />
              <ColorSwatchField
                label="Background color"
                value={draftStyle.backgroundColor}
                onChange={(v) => setDraftStyle((s) => ({ ...s, backgroundColor: v }))}
              />
              <ColorSwatchField
                label="Hover background"
                value={draftStyle.hoverBackgroundColor}
                onChange={(v) => setDraftStyle((s) => ({ ...s, hoverBackgroundColor: v }))}
              />
              <Select
                label="Border radius"
                value={draftStyle.borderRadius ?? "none"}
                onChange={(e) => setDraftStyle((s) => ({ ...s, borderRadius: e.target.value as MenuItemStyle["borderRadius"] }))}
              >
                <option value="none">None</option>
                <option value="slight">Slight</option>
                <option value="pill">Pill</option>
              </Select>
              <Select
                label="Font weight"
                value={draftStyle.fontWeight ?? "normal"}
                onChange={(e) => setDraftStyle((s) => ({ ...s, fontWeight: e.target.value as MenuItemStyle["fontWeight"] }))}
              >
                <option value="normal">Normal</option>
                <option value="medium">Medium</option>
                <option value="bold">Bold</option>
              </Select>
            </div>
          </div>

          {type === "LINK" && (
            <Combobox
              label="Collection"
              value={linkCollectionId}
              onChange={setLinkCollectionId}
              placeholder="Select a collection…"
              options={collections.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          )}

          {type === "DROPDOWN" && (
            <div className="space-y-2">
              {dropdownCollections.length > 0 && (
                <ul className="space-y-1">
                  {dropdownCollections.map((c) => (
                    <li key={c.collectionId} className="flex items-center justify-between text-sm bg-black/[0.03] dark:bg-white/[0.05] rounded px-2 py-1">
                      {c.name}
                      <Tooltip label={`Remove ${c.name} from this dropdown`}>
                        <button
                          type="button"
                          onClick={() =>
                            setDropdownCollections((prev) => prev.filter((x) => x.collectionId !== c.collectionId))
                          }
                          aria-label={`Remove ${c.name}`}
                          className="text-text-faint hover:text-red-600 cursor-pointer"
                        >
                          <X className="size-3.5" />
                        </button>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Combobox
                    label="Add collection"
                    value={addDropdownCollectionId}
                    onChange={setAddDropdownCollectionId}
                    placeholder="Select a collection…"
                    options={collections.map((c) => ({ value: String(c.id), label: c.name }))}
                  />
                </div>
                <Button type="button" variant="secondary" onClick={addDropdownCollection} disabled={!addDropdownCollectionId}>
                  <Plus className="size-4 inline -mt-0.5 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          )}

          {type === "MEGA" && (
            <div className="space-y-2">
              {draftColumns.map((column, index) => (
                <MegaColumnEditor
                  key={index}
                  column={column}
                  index={index}
                  collections={collections}
                  products={products}
                  draggedIndex={draggedColumnIndex}
                  onDragStart={() => setDraggedColumnIndex(index)}
                  onDrop={() => handleColumnDrop(index)}
                  onTitleChange={(title) => updateColumnTitle(index, title)}
                  onRemoveColumn={() => removeColumn(index)}
                  onAddLink={() => addLink(index)}
                  onChangeLink={(linkIndex, patch) => changeLink(index, linkIndex, patch)}
                  onRemoveLink={(linkIndex) => removeLink(index, linkIndex)}
                />
              ))}
              <Button type="button" variant="secondary" onClick={addColumn}>
                <Plus className="size-4 inline -mt-0.5 mr-1" />
                Add column
              </Button>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={startCreate}>
          <Plus className="size-4 inline -mt-0.5 mr-1" />
          Add menu item
        </Button>
      )}
    </div>
  );
}
