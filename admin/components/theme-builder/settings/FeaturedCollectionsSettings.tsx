"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import Combobox from "@/components/ui/Combobox";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { listCollections } from "@/lib/api";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { Collection, ScrollAnimation, SectionVisibility } from "@/lib/types";

// Heading and "View all" button text now live on this section's Header
// block's collection_title/view_all_button sub-blocks — expand the section
// in the tree to edit them.
export default function FeaturedCollectionsSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [addId, setAddId] = useState("");

  useEffect(() => {
    listCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  const collectionIds = Array.isArray(settings.collectionIds) ? (settings.collectionIds as string[]) : [];
  const byId = new Map(collections.map((c) => [String(c.id), c]));

  function addCollection() {
    if (!addId || collectionIds.includes(addId)) return;
    onUpdate("collectionIds", [...collectionIds, addId]);
    setAddId("");
  }

  function removeCollection(id: string) {
    onUpdate(
      "collectionIds",
      collectionIds.filter((cid) => cid !== id),
    );
  }

  function moveCollection(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= collectionIds.length) return;
    const next = [...collectionIds];
    [next[index], next[target]] = [next[target], next[index]];
    onUpdate("collectionIds", next);
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Collections to show</span>
        {collectionIds.length > 0 && (
          <ul className="mb-2 space-y-1">
            {collectionIds.map((id, i) => (
              <li
                key={id}
                className="flex items-center justify-between gap-1 rounded bg-black/[0.03] px-2 py-1 text-sm dark:bg-white/[0.05]"
              >
                <span className="truncate">{byId.get(id)?.name ?? `Collection ${id}`}</span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveCollection(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="p-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-30 dark:hover:text-zinc-200"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveCollection(i, 1)}
                    disabled={i === collectionIds.length - 1}
                    aria-label="Move down"
                    className="p-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-30 dark:hover:text-zinc-200"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCollection(id)}
                    aria-label="Remove"
                    className="p-1 text-zinc-400 hover:text-red-600"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Combobox
              value={addId}
              onChange={setAddId}
              placeholder="Add a collection…"
              searchPlaceholder="Search collections…"
              options={collections
                .filter((c) => !collectionIds.includes(String(c.id)))
                .map((c) => ({ value: String(c.id), label: c.name }))}
            />
          </div>
          <Button type="button" variant="secondary" onClick={addCollection} disabled={!addId}>
            <Plus className="size-4 inline -mt-0.5 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {collectionIds.length === 0 && (
        <Input
          label="Maximum collections"
          type="number"
          min={1}
          max={20}
          placeholder="All"
          value={settings.maxCollections != null ? (settings.maxCollections as number) : ""}
          onChange={(e) => {
            const raw = e.target.value;
            onUpdate("maxCollections", raw === "" ? undefined : Math.max(1, Math.min(20, Number(raw) || 1)));
          }}
        />
      )}

      <hr className="border-black/10 dark:border-white/10" />

      <SpacingControls
        value={settings.spacing as SpacingValue}
        onChange={(v) => onUpdate("spacing", v)}
      />
      <BackgroundControls
        value={settings.background as BackgroundValue}
        onChange={(v) => onUpdate("background", v)}
      />
      <ScrollAnimationControl
        value={settings.scrollAnimation as ScrollAnimation}
        onChange={(v) => onUpdate("scrollAnimation", v)}
      />
      <VisibilityControl
        value={settings.visibility as SectionVisibility}
        onChange={(v) => onUpdate("visibility", v)}
      />
    </div>
  );
}
