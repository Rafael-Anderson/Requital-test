"use client";

import { useEffect, useState } from "react";
import Select from "@/components/ui/Select";
import Combobox from "@/components/ui/Combobox";
import Input from "@/components/ui/Input";
import { listCollections } from "@/lib/api";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { Collection, ScrollAnimation, SectionVisibility } from "@/lib/types";

const CARD_STYLES = ["minimal", "bordered", "shadowed"] as const;
const DEFAULT_PRODUCT_LIMIT = 8;

// Whether media/title/price show on each card is now controlled per
// sub-block (expand the section's Product card node in the tree) —
// "Show rating" was dropped entirely rather than migrated: it never did
// anything (Product has no rating field anywhere in this codebase).
export default function ProductGridSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    listCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  return (
    <div className="space-y-4">
      <Input
        label="Section title"
        value={(settings.sectionTitle as string) ?? ""}
        placeholder="Our Products"
        onChange={(e) => onUpdate("sectionTitle", e.target.value)}
      />
      <div>
        <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Show products from</span>
        <Combobox
          value={settings.collectionId != null ? String(settings.collectionId) : ""}
          onChange={(v) => onUpdate("collectionId", v ? Number(v) : undefined)}
          options={collections.map((c) => ({ value: String(c.id), label: c.name }))}
          placeholder="All products"
          searchPlaceholder="Search collections…"
        />
      </div>
      <Input
        label="Number of products"
        type="number"
        min={1}
        max={50}
        value={(settings.productLimit as number) ?? DEFAULT_PRODUCT_LIMIT}
        onChange={(e) => onUpdate("productLimit", Math.max(1, Math.min(50, Number(e.target.value) || DEFAULT_PRODUCT_LIMIT)))}
      />
      <Input
        label="Quick add button text"
        value={(settings.quickAddLabel as string) ?? ""}
        placeholder="Add"
        onChange={(e) => onUpdate("quickAddLabel", e.target.value)}
      />
      <Select
        label="Columns"
        value={String((settings.columns as number) ?? 3)}
        onChange={(e) => onUpdate("columns", Number(e.target.value))}
      >
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4</option>
        <option value="5">5</option>
        <option value="6">6</option>
      </Select>
      <Select
        label="Mobile columns"
        value={settings.mobileColumns ? String(settings.mobileColumns) : "auto"}
        onChange={(e) => onUpdate("mobileColumns", e.target.value === "auto" ? undefined : Number(e.target.value))}
      >
        <option value="auto">Auto</option>
        <option value="1">1</option>
        <option value="2">2</option>
      </Select>
      <Select
        label="Card style"
        value={(settings.cardStyle as string) ?? "minimal"}
        onChange={(e) => onUpdate("cardStyle", e.target.value)}
      >
        {CARD_STYLES.map((s) => (
          <option key={s} value={s}>
            {s[0].toUpperCase() + s.slice(1)}
          </option>
        ))}
      </Select>

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
