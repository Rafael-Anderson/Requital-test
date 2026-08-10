"use client";

import { useEffect, useState } from "react";
import { GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  createMenuItem,
  deleteMenuItem,
  listCollections,
  listMenuItems,
  reorderMenuItems,
  updateMenuItem,
} from "@/lib/api";
import { MENU_ITEM_TYPES, type Collection, type MenuItem, type MenuItemType } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Combobox from "@/components/ui/Combobox";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import { useToast } from "@/components/ui/Toast";
import Tooltip from "@/components/ui/Tooltip";

interface DraftCollection {
  collectionId: number;
  name: string;
}

// The storefront top bar's merchant-configured nav (Phase C) — a merchant-
// ordered list of LINK (one Collection) / DROPDOWN (several Collections)
// items. Each row is its own real create/update/delete call (no batching
// with the surrounding page's Save button, same "immediate persistence"
// convention Bio Links uses); row order persists via the same native-drag +
// dedicated /reorder-endpoint pattern as Bio Links/Collections. A
// Dropdown's own member-collection list is add/remove-ordered (insertion
// order, no drag) — small lists nested inside an already-open inline form,
// not worth a second drag surface.
export default function MenuBuilder() {
  const toast = useToast();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [draggedId, setDraggedId] = useState<number | null>(null);

  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<MenuItemType>("LINK");
  const [linkCollectionId, setLinkCollectionId] = useState("");
  const [dropdownCollections, setDropdownCollections] = useState<DraftCollection[]>([]);
  const [addDropdownCollectionId, setAddDropdownCollectionId] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = () => listMenuItems().then(setItems).catch(() => setItems([]));

  useEffect(() => {
    refresh();
    listCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  function startCreate() {
    setEditingId("new");
    setLabel("");
    setType("LINK");
    setLinkCollectionId("");
    setDropdownCollections([]);
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
    setSaving(true);
    try {
      const data = {
        label: label.trim(),
        type,
        ...(type === "LINK" ? { collectionId: Number(linkCollectionId) } : {}),
        ...(type === "DROPDOWN"
          ? { collections: dropdownCollections.map((c, i) => ({ collectionId: c.collectionId, sortOrder: i })) }
          : {}),
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
    return <p className="text-sm text-zinc-400">Loading…</p>;
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && editingId === null ? (
        <p className="text-sm text-zinc-400">No menu items yet — the storefront falls back to an automatic list of top-level collections.</p>
      ) : (
        <div className="rounded-lg border dark:border-white/10 divide-y divide-black/5 dark:divide-white/10 overflow-hidden">
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
              <span className="cursor-grab active:cursor-grabbing text-zinc-400 shrink-0" aria-hidden>
                <GripVertical className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-zinc-400 ml-2 text-xs">
                  {item.type === "LINK"
                    ? item.collection?.name ?? "Link"
                    : `Dropdown · ${item.collections.length} collection${item.collections.length === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="flex gap-1 shrink-0">
                <Tooltip label={`Edit ${item.label}`}>
                  <button
                    onClick={() => startEdit(item)}
                    className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    aria-label={`Edit ${item.label}`}
                  >
                    <Pencil className="size-4" />
                  </button>
                </Tooltip>
                <Tooltip label={`Remove ${item.label} from the menu`} align="end">
                  <button
                    onClick={() => handleDelete(item)}
                    className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
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
        <div className="rounded-lg border dark:border-white/10 p-3 space-y-3">
          <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <SegmentedToggle
            value={type}
            options={MENU_ITEM_TYPES.map((t) => ({ value: t, label: t === "LINK" ? "Link" : "Dropdown" }))}
            onChange={setType}
          />

          {type === "LINK" ? (
            <Combobox
              label="Collection"
              value={linkCollectionId}
              onChange={setLinkCollectionId}
              placeholder="Select a collection…"
              options={collections.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          ) : (
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
                          className="text-zinc-400 hover:text-red-600 cursor-pointer"
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
