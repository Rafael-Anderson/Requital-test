"use client";

import { useEffect, useState } from "react";
import Select from "@/components/ui/Select";
import Combobox from "@/components/ui/Combobox";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import { listCollections } from "@/lib/api";
import RichTextBlockEditor from "../RichTextBlockEditor";
import { schemeColorPresets } from "@/lib/scheme-color-presets";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { ThemeEditorState } from "@/lib/useThemeEditor";
import type { Collection, ScrollAnimation, SectionVisibility } from "@/lib/types";

// Phase B1 — extended card style set (shared shape with globalSettings.productCards.cardStyle).
const CARD_STYLES = [
  "minimal",
  "bordered",
  "shadowed",
  "elevated",
  "outlined-hover",
  "filled",
  "polaroid",
  "overlay",
] as const;
const IMAGE_ASPECTS = [
  { value: "", label: "Default (from Product cards)" },
  { value: "square", label: "Square" },
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
  { value: "tall", label: "Tall" },
] as const;
const DEFAULT_PRODUCT_LIMIT = 8;

// Whether media/title/price show on each card is now controlled per
// sub-block (expand the section's Product card node in the tree) —
// "Show rating" was dropped entirely rather than migrated: it never did
// anything (Product has no rating field anywhere in this codebase).
export default function ProductGridSettings({
  settings,
  onUpdate,
  editor,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
  editor?: ThemeEditorState;
}) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const colorPresets = schemeColorPresets(editor?.config?.globalSettings.colorSchemes);
  const sectionId = editor?.selection?.kind === "section" ? editor.selection.section.id : "product_grid";

  useEffect(() => {
    listCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  return (
    <div className="space-y-4">
      <RichTextBlockEditor
        blockId={`product-grid-title-${sectionId}`}
        label="Section title"
        mode="inline"
        value={(settings.sectionTitle as string) ?? ""}
        onChange={(html) => onUpdate("sectionTitle", html)}
        colorPresets={colorPresets}
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
      {settings.collectionId != null && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Show &quot;View all&quot; button</span>
            <Toggle checked={(settings.showViewAllButton as boolean) ?? true} onChange={(v) => onUpdate("showViewAllButton", v)} />
          </div>
          {settings.showViewAllButton !== false && (
            <>
              <Input
                label="View all button label"
                value={(settings.viewAllLabel as string) ?? ""}
                placeholder="View all"
                onChange={(e) => onUpdate("viewAllLabel", e.target.value)}
              />
              {/* §8.15 follow-up — "Link" writes undefined ⇒ today's plain link. */}
              <Select
                label="View all display"
                value={(settings.viewAllStyle as string) ?? "link"}
                onChange={(e) => onUpdate("viewAllStyle", e.target.value === "link" ? undefined : e.target.value)}
              >
                <option value="link">Text link</option>
                <option value="button">Button</option>
              </Select>
            </>
          )}
        </>
      )}
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
            {s[0].toUpperCase() + s.slice(1).replace("-", " ")}
          </option>
        ))}
      </Select>
      <Select
        label="Image shape"
        value={(settings.imageAspect as string) ?? ""}
        onChange={(e) => onUpdate("imageAspect", e.target.value || undefined)}
      >
        {IMAGE_ASPECTS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
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
        stagger={(settings.motion as { stagger?: boolean } | undefined)?.stagger}
        onStaggerChange={(v) => onUpdate("motion", { ...(settings.motion as object), stagger: v })}
      />
      <VisibilityControl
        value={settings.visibility as SectionVisibility}
        onChange={(v) => onUpdate("visibility", v)}
      />
    </div>
  );
}
