"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import Combobox from "@/components/ui/Combobox";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import { listBrands } from "@/lib/api";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { Brand, ScrollAnimation, SectionVisibility } from "@/lib/types";

const LOGOS_PER_ROW = [3, 4, 5, 6, 7, 8] as const;

// A "Brands" homepage section — renders the shop's brand logos as a
// horizontal strip on the storefront. An empty brandIds list means "show
// all brands (with an available product)"; a non-empty list is an explicit,
// ordered subset. No blocks (settings-only), same as announcement_bar.
export default function BrandsSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [addId, setAddId] = useState("");

  useEffect(() => {
    listBrands().then(setBrands).catch(() => setBrands([]));
  }, []);

  const brandIds = Array.isArray(settings.brandIds) ? (settings.brandIds as string[]) : [];
  const byId = new Map(brands.map((b) => [String(b.id), b]));
  const logosPerRow = typeof settings.logosPerRow === "number" ? settings.logosPerRow : 5;

  function addBrand() {
    if (!addId || brandIds.includes(addId)) return;
    onUpdate("brandIds", [...brandIds, addId]);
    setAddId("");
  }

  function removeBrand(id: string) {
    onUpdate(
      "brandIds",
      brandIds.filter((bid) => bid !== id),
    );
  }

  function moveBrand(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= brandIds.length) return;
    const next = [...brandIds];
    [next[index], next[target]] = [next[target], next[index]];
    onUpdate("brandIds", next);
  }

  return (
    <div className="space-y-4">
      <Input
        label="Heading (optional)"
        value={(settings.heading as string) ?? ""}
        onChange={(e) => onUpdate("heading", e.target.value)}
        placeholder="Shop by brand"
      />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Brands to show</span>
        {brandIds.length > 0 && (
          <ul className="mb-2 space-y-1">
            {brandIds.map((id, i) => (
              <li
                key={id}
                className="flex items-center justify-between gap-1 rounded bg-black/[0.03] px-2 py-1 text-sm dark:bg-white/[0.05]"
              >
                <span className="truncate">{byId.get(id)?.name ?? `Brand ${id}`}</span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveBrand(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="p-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-30 dark:hover:text-zinc-200"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBrand(i, 1)}
                    disabled={i === brandIds.length - 1}
                    aria-label="Move down"
                    className="p-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-30 dark:hover:text-zinc-200"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBrand(id)}
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
              placeholder="Add a brand…"
              searchPlaceholder="Search brands…"
              options={brands
                .filter((b) => !brandIds.includes(String(b.id)))
                .map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </div>
          <Button type="button" variant="secondary" onClick={addBrand} disabled={!addId}>
            <Plus className="size-4 inline -mt-0.5 mr-1" />
            Add
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-zinc-500">Leave empty to show every brand that has an available product.</p>
      </div>

      <Select
        label="Logos per row"
        value={String(logosPerRow)}
        onChange={(e) => onUpdate("logosPerRow", Number(e.target.value))}
      >
        {LOGOS_PER_ROW.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>

      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">
          Link logos to a brand page
          <span className="block text-xs font-normal text-zinc-500">
            Each logo opens a listing of that brand&apos;s products.
          </span>
        </span>
        <Toggle checked={settings.linkBrands === true} onChange={(v) => onUpdate("linkBrands", v)} />
      </div>

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
