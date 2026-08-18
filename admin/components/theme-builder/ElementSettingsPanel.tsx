"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Select from "@/components/ui/Select";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Slider from "@/components/ui/Slider";
import ColorPicker from "@/components/ui/ColorPicker";
import FontPicker from "@/components/ui/FontPicker";
import Toggle from "@/components/ui/Toggle";
import ImageDropzone from "@/components/ui/ImageDropzone";
import BlockSettingsForm from "./BlockSettingsForm";
import RichTextBlockEditor from "./RichTextBlockEditor";
import { uploadThemeImage, resolveImageUrl } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import type { ThemeBlock } from "@/lib/types";
import type { BlockContainerRef } from "@/lib/useThemeEditor";

// Richer per-element-type style controls for the block types a merchant can
// double-click select in the live preview (PreviewInteraction.tsx,
// storefront-side) — font/color/spacing/etc, not just the bare content
// field BlockSettingsForm.tsx already gave every block type. Block types
// outside these 5 families (icons, footer_column, testimonial, the
// container-only collection_header/product_card, ...) fall straight
// through to the existing BlockSettingsForm unchanged — this file adds a
// richer layer on top for the specific types below, it doesn't replace the
// simpler form for everything else.
const TEXT_TYPES = new Set(["heading", "subheading", "collection_title", "text", "footer_copyright", "product_title"]);
const IMAGE_TYPES = new Set(["logo", "image"]);
const BUTTON_TYPES = new Set(["cta", "view_all_button", "email_form"]);
const NAV_TYPES = new Set(["nav_menu"]);
const PRICE_TYPES = new Set(["product_price"]);
const ICON_TYPES = new Set(["search_icon", "cart_icon", "account_icon"]);

interface FamilyProps {
  block: ThemeBlock;
  onUpdate: (key: string, value: unknown) => void;
  onToggleVisibility: () => void;
  container?: BlockContainerRef;
}

const FONT_WEIGHTS = [
  { value: "300", label: "Light" },
  { value: "400", label: "Normal" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semi-bold" },
  { value: "700", label: "Bold" },
];

// heading/subheading/collection_title/text/footer_copyright have a plain
// free-text "text" setting (see BlockSettingsForm's own per-type dispatch);
// product_title is driven by real product data and has no content field of
// its own, style-only.
const TEXT_CONTENT_KEY: Record<string, string | undefined> = {
  heading: "text",
  subheading: "text",
  collection_title: "text",
  text: "text",
  footer_copyright: "text",
  product_title: undefined,
};

// The rich_text section's own "text" block gets the contenteditable
// bold/italic/underline editor (RichTextBlockEditor) instead of a plain
// Textarea — every other TEXT_TYPES member (heading/subheading/
// collection_title/footer_copyright, and "text" blocks belonging to
// image_text/newsletter, which share the same block *type* but aren't rich
// text) keeps the existing plain-text field. `container.sectionType` is
// what disambiguates "text" here, since block.type alone can't: it's the
// shared child type of three different sections (backend constants.ts's
// BLOCK_TYPES.rich_text/image_text/newsletter).
function isRichTextBlock(block: ThemeBlock, container?: BlockContainerRef): boolean {
  return block.type === "text" && container?.kind === "section" && container.sectionType === "rich_text";
}

function TextElementSettings({ block, onUpdate, container }: FamilyProps) {
  const s = block.settings;
  const contentKey = TEXT_CONTENT_KEY[block.type];
  const richText = isRichTextBlock(block, container);
  return (
    <div className="space-y-4">
      {contentKey && richText ? (
        <RichTextBlockEditor blockId={block.id} value={(s[contentKey] as string) ?? ""} onChange={(html) => onUpdate(contentKey, html)} />
      ) : (
        contentKey && (
          <Textarea
            label="Text content"
            rows={3}
            value={(s[contentKey] as string) ?? ""}
            onChange={(e) => onUpdate(contentKey, e.target.value)}
          />
        )
      )}
      <Slider label="Font size" min={10} max={96} value={(s.fontSize as number) ?? 16} onChange={(v) => onUpdate("fontSize", v)} suffix="px" />
      <Select label="Font weight" value={(s.fontWeight as string) ?? "400"} onChange={(e) => onUpdate("fontWeight", e.target.value)}>
        {FONT_WEIGHTS.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </Select>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Color</span>
        <ColorPicker value={(s.color as string) ?? "#18181b"} onChange={(hex) => onUpdate("color", hex)} />
      </div>
      <FontPicker label="Font family" value={(s.fontFamily as string) ?? ""} onChange={(v) => onUpdate("fontFamily", v)} />
      <Select label="Letter spacing" value={(s.letterSpacing as string) ?? "normal"} onChange={(e) => onUpdate("letterSpacing", e.target.value)}>
        <option value="tight">Tight</option>
        <option value="normal">Normal</option>
        <option value="wide">Wide</option>
      </Select>
      <div>
        <p className="mb-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400">Text align</p>
        <SegmentedToggle
          value={(s.textAlign as string) ?? "left"}
          onChange={(v) => onUpdate("textAlign", v)}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Right" },
          ]}
        />
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400">Text transform</p>
        <SegmentedToggle
          value={(s.textTransform as string) ?? "none"}
          onChange={(v) => onUpdate("textTransform", v)}
          options={[
            { value: "none", label: "Default" },
            { value: "uppercase", label: "Uppercase" },
          ]}
        />
      </div>
      <Select label="Line height" value={(s.lineHeight as string) ?? "normal"} onChange={(e) => onUpdate("lineHeight", e.target.value)}>
        <option value="tight">Tight</option>
        <option value="normal">Normal</option>
        <option value="loose">Loose</option>
      </Select>
    </div>
  );
}

function ImageElementSettings({ block, onUpdate }: FamilyProps) {
  const s = block.settings;
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  async function handleImage(file: File) {
    setUploading(true);
    try {
      const { url } = await uploadThemeImage(file);
      onUpdate("imageUrl", url);
    } catch {
      toast("Failed to upload image", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <ImageDropzone
        preview={resolveImageUrl((s.imageUrl as string) ?? null)}
        onFileSelected={(file) => void handleImage(file)}
        label={uploading ? "Uploading..." : "Image"}
      />
      <Input label="Alt text" value={(s.alt as string) ?? ""} onChange={(e) => onUpdate("alt", e.target.value)} />
      <Select label="Object fit" value={(s.objectFit as string) ?? "cover"} onChange={(e) => onUpdate("objectFit", e.target.value)}>
        <option value="cover">Cover</option>
        <option value="contain">Contain</option>
        <option value="fill">Fill</option>
      </Select>
      <Slider label="Width" min={20} max={800} value={(s.width as number) ?? 160} onChange={(v) => onUpdate("width", v)} suffix="px" />
      <Slider label="Border radius" min={0} max={64} value={(s.borderRadius as number) ?? 0} onChange={(v) => onUpdate("borderRadius", v)} suffix="px" />
      <Input label="Link URL" placeholder="https://…" value={(s.linkUrl as string) ?? ""} onChange={(e) => onUpdate("linkUrl", e.target.value)} />
      {/* widthPercent/alignment (storefront-v2 Phase 4B) — only meaningful
          for a standalone Image block dropped into Header/Footer/Hero/Rich
          Text's own content area (see each section's own 'image' render
          case); image_text's own image half keeps using width(px)/
          objectFit above unchanged, since it always fills a fixed-aspect
          container instead. */}
      <Select
        label="Display width (%)"
        value={String((s.widthPercent as number) ?? 100)}
        onChange={(e) => onUpdate("widthPercent", Number(e.target.value))}
      >
        <option value="25">25%</option>
        <option value="50">50%</option>
        <option value="75">75%</option>
        <option value="100">100%</option>
      </Select>
      <Select label="Alignment" value={(s.alignment as string) ?? "left"} onChange={(e) => onUpdate("alignment", e.target.value)}>
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </Select>
    </div>
  );
}

// cta/view_all_button/email_form each have their own free-text field —
// mirrors TEXT_CONTENT_KEY above but for the button-family "label" content.
const BUTTON_CONTENT_KEY: Record<string, string> = {
  cta: "label",
  view_all_button: "label",
  email_form: "buttonLabel",
};

function ButtonElementSettings({ block, onUpdate }: FamilyProps) {
  const s = block.settings;
  const contentKey = BUTTON_CONTENT_KEY[block.type] ?? "label";
  return (
    <div className="space-y-4">
      <Input label="Button text" value={(s[contentKey] as string) ?? ""} onChange={(e) => onUpdate(contentKey, e.target.value)} />
      <Input label="Link URL" placeholder="https://…" value={(s.linkUrl as string) ?? ""} onChange={(e) => onUpdate("linkUrl", e.target.value)} />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Background color</span>
        <ColorPicker value={(s.backgroundColor as string) ?? "#069494"} onChange={(hex) => onUpdate("backgroundColor", hex)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Text color</span>
        <ColorPicker value={(s.textColor as string) ?? "#ffffff"} onChange={(hex) => onUpdate("textColor", hex)} />
      </div>
      <Slider label="Border radius" min={0} max={48} value={(s.borderRadius as number) ?? 8} onChange={(v) => onUpdate("borderRadius", v)} suffix="px" />
      <Slider label="Border thickness" min={0} max={8} value={(s.borderWidth as number) ?? 0} onChange={(v) => onUpdate("borderWidth", v)} suffix="px" />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Border color</span>
        <ColorPicker value={(s.borderColor as string) ?? "#069494"} onChange={(hex) => onUpdate("borderColor", hex)} />
      </div>
      <Slider label="Padding (horizontal)" min={0} max={64} value={(s.paddingX as number) ?? 24} onChange={(v) => onUpdate("paddingX", v)} suffix="px" />
      <Slider label="Padding (vertical)" min={0} max={40} value={(s.paddingY as number) ?? 12} onChange={(v) => onUpdate("paddingY", v)} suffix="px" />
      <Slider label="Font size" min={10} max={32} value={(s.fontSize as number) ?? 14} onChange={(v) => onUpdate("fontSize", v)} suffix="px" />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Full width</span>
        <Toggle checked={(s.fullWidth as boolean) ?? false} onChange={(v) => onUpdate("fullWidth", v)} />
      </div>
    </div>
  );
}

// No "menu label" field here — nav_menu's actual link labels come from the
// shop's separate Menu items (see backend menu/ module + MenuBar.tsx), a
// different data model this block doesn't own; this block only governs
// this element's style + visibility, which is all these controls touch.
function NavElementSettings({ block, onUpdate }: FamilyProps) {
  const s = block.settings;
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        The navigation menu&apos;s position is fixed below the header — the controls below style it (and the header
        it sits under) rather than repositioning it.
      </p>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Header background color</span>
        <ColorPicker value={(s.headerBackgroundColor as string) ?? "#ffffff"} onChange={(hex) => onUpdate("headerBackgroundColor", hex)} />
      </div>
      <Slider label="Font size" min={10} max={24} value={(s.fontSize as number) ?? 14} onChange={(v) => onUpdate("fontSize", v)} suffix="px" />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Font color</span>
        <ColorPicker value={(s.color as string) ?? "#3f3f46"} onChange={(hex) => onUpdate("color", hex)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Hover color</span>
        <ColorPicker value={(s.hoverColor as string) ?? "#069494"} onChange={(hex) => onUpdate("hoverColor", hex)} />
      </div>
      <Select label="Font weight" value={(s.fontWeight as string) ?? "400"} onChange={(e) => onUpdate("fontWeight", e.target.value)}>
        {FONT_WEIGHTS.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </Select>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Show on mobile</span>
        <Toggle checked={(s.showOnMobile as boolean) ?? true} onChange={(v) => onUpdate("showOnMobile", v)} />
      </div>
    </div>
  );
}

function PriceElementSettings({ block, onUpdate }: FamilyProps) {
  const s = block.settings;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Show currency code</span>
        <Toggle checked={(s.showCurrencyCode as boolean) ?? false} onChange={(v) => onUpdate("showCurrencyCode", v)} />
      </div>
      <Slider label="Font size" min={10} max={32} value={(s.fontSize as number) ?? 14} onChange={(v) => onUpdate("fontSize", v)} suffix="px" />
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Color (regular price)</span>
        <ColorPicker value={(s.color as string) ?? "#18181b"} onChange={(hex) => onUpdate("color", hex)} />
      </div>
      <p className="text-xs text-zinc-500">
        Sale/compare-at pricing isn&apos;t shown in this homepage product grid today, so those colors have nothing to
        apply to yet.
      </p>
    </div>
  );
}

const ZONE_OPTIONS = ["left", "center", "right"] as const;

// The minimum bar Part 5 asks for on a type without its own rich panel:
// visibility + color + size, on top of the position selector
// BlockSettingsForm already gave these three (logo/nav_menu share that
// selector too, but they get the richer Image/Nav panels above instead —
// only the plain icon types land here).
function IconElementSettings({ block, onUpdate, onToggleVisibility }: FamilyProps) {
  const s = block.settings;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Visible</span>
        <Toggle checked={block.visible} onChange={onToggleVisibility} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Color</span>
        <ColorPicker value={(s.color as string) ?? "#18181b"} onChange={(hex) => onUpdate("color", hex)} />
      </div>
      <Slider label="Size" min={12} max={40} value={(s.size as number) ?? 20} onChange={(v) => onUpdate("size", v)} suffix="px" />
      <Select label="Position" value={(s.zone as string) ?? "left"} onChange={(e) => onUpdate("zone", e.target.value)}>
        {ZONE_OPTIONS.map((zone) => (
          <option key={zone} value={zone}>
            {zone[0].toUpperCase() + zone.slice(1)}
          </option>
        ))}
      </Select>
    </div>
  );
}

export default function ElementSettingsPanel({ block, onUpdate, onToggleVisibility, container }: FamilyProps) {
  if (TEXT_TYPES.has(block.type)) return <TextElementSettings block={block} onUpdate={onUpdate} onToggleVisibility={onToggleVisibility} container={container} />;
  if (IMAGE_TYPES.has(block.type)) return <ImageElementSettings block={block} onUpdate={onUpdate} onToggleVisibility={onToggleVisibility} />;
  if (BUTTON_TYPES.has(block.type)) return <ButtonElementSettings block={block} onUpdate={onUpdate} onToggleVisibility={onToggleVisibility} />;
  if (NAV_TYPES.has(block.type)) return <NavElementSettings block={block} onUpdate={onUpdate} onToggleVisibility={onToggleVisibility} />;
  if (PRICE_TYPES.has(block.type)) return <PriceElementSettings block={block} onUpdate={onUpdate} onToggleVisibility={onToggleVisibility} />;
  if (ICON_TYPES.has(block.type)) return <IconElementSettings block={block} onUpdate={onUpdate} onToggleVisibility={onToggleVisibility} />;
  return <BlockSettingsForm block={block} onUpdate={onUpdate} />;
}
