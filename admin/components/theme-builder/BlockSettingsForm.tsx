"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { uploadThemeImage, resolveImageUrl } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import type { ThemeBlock } from "@/lib/types";

interface FooterColumnLink {
  label: string;
  url: string;
}

const ZONE_OPTIONS = ["left", "center", "right"] as const;

// Per-block-type content settings — a block's own settings is free-form
// JSON (shallow-validated server-side), so this is the one place that
// convention per block type lives. Most types have 1-3 fields; container-
// only types (collection_header, product_card) and pure-visibility leaf
// types (product_media/title/price, footer_social) have no content of
// their own — the tree's eye icon is the only control they need.
export default function BlockSettingsForm({
  block,
  onUpdate,
}: {
  block: ThemeBlock;
  onUpdate: (key: string, value: unknown) => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  switch (block.type) {
    case "logo":
    case "nav_menu":
    case "search_icon":
    case "cart_icon":
    case "account_icon":
      return (
        <Select label="Position" value={(block.settings.zone as string) ?? "left"} onChange={(e) => onUpdate("zone", e.target.value)}>
          {ZONE_OPTIONS.map((zone) => (
            <option key={zone} value={zone}>
              {zone[0].toUpperCase() + zone.slice(1)}
            </option>
          ))}
        </Select>
      );

    case "announcement":
      return <Input label="Text" value={(block.settings.text as string) ?? ""} onChange={(e) => onUpdate("text", e.target.value)} />;

    case "heading":
      return (
        <Input label="Heading" value={(block.settings.text as string) ?? ""} onChange={(e) => onUpdate("text", e.target.value)} />
      );

    case "subheading":
      return (
        <Input label="Subheading" value={(block.settings.text as string) ?? ""} onChange={(e) => onUpdate("text", e.target.value)} />
      );

    case "cta":
      return (
        <Input label="Button label" value={(block.settings.label as string) ?? ""} onChange={(e) => onUpdate("label", e.target.value)} />
      );

    case "collection_title":
      return (
        <Input
          label="Heading"
          placeholder="Featured Collections"
          value={(block.settings.text as string) ?? ""}
          onChange={(e) => onUpdate("text", e.target.value)}
        />
      );

    case "view_all_button":
      return (
        <Input
          label="Button label"
          placeholder="View all"
          value={(block.settings.label as string) ?? ""}
          onChange={(e) => onUpdate("label", e.target.value)}
        />
      );

    case "testimonial": {
      async function handlePhoto(file: File) {
        setUploading(true);
        try {
          const { url } = await uploadThemeImage(file);
          onUpdate("photoUrl", url);
        } catch {
          toast("Failed to upload image", "error");
        } finally {
          setUploading(false);
        }
      }
      const rating = (block.settings.rating as number) ?? 0;
      return (
        <div className="space-y-3">
          <Textarea label="Quote" rows={3} value={(block.settings.quote as string) ?? ""} onChange={(e) => onUpdate("quote", e.target.value)} />
          <Input label="Author" value={(block.settings.author as string) ?? ""} onChange={(e) => onUpdate("author", e.target.value)} />
          <ImageDropzone
            preview={resolveImageUrl((block.settings.photoUrl as string) ?? null)}
            onFileSelected={(file) => void handlePhoto(file)}
            label={uploading ? "Uploading..." : "Author photo"}
          />
          <div>
            <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">Rating</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => onUpdate("rating", rating === star ? undefined : star)}
                  aria-label={`${star} star${star === 1 ? "" : "s"}`}
                  className={`text-xl leading-none ${star <= rating ? "text-amber-500" : "text-zinc-300 dark:text-zinc-700"}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    case "text":
      return <Textarea label="Text" rows={4} value={(block.settings.text as string) ?? ""} onChange={(e) => onUpdate("text", e.target.value)} />;

    case "image": {
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
        <ImageDropzone
          preview={resolveImageUrl((block.settings.imageUrl as string) ?? null)}
          onFileSelected={(file) => void handleImage(file)}
          label={uploading ? "Uploading..." : "Image"}
        />
      );
    }

    case "email_form":
      return (
        <Input
          label="Button label"
          placeholder="Subscribe"
          value={(block.settings.buttonLabel as string) ?? ""}
          onChange={(e) => onUpdate("buttonLabel", e.target.value)}
        />
      );

    case "footer_copyright":
      return (
        <Input
          label="Copyright text"
          placeholder="© 2026 Your Store. All Rights Reserved"
          value={(block.settings.text as string) ?? ""}
          onChange={(e) => onUpdate("text", e.target.value)}
        />
      );

    case "footer_social":
      return <p className="text-xs text-zinc-500">Shows the icons for whichever social links are set on Business Information.</p>;

    case "footer_column": {
      const links = (block.settings.links as FooterColumnLink[] | undefined) ?? [];
      function updateLinks(next: FooterColumnLink[]) {
        onUpdate("links", next);
      }
      return (
        <div className="space-y-3">
          <Input label="Column title" value={(block.settings.title as string) ?? ""} onChange={(e) => onUpdate("title", e.target.value)} />
          <div className="space-y-2">
            {links.map((link, i) => (
              <div key={i} className="flex items-end gap-1.5">
                <Input
                  label={i === 0 ? "Label" : ""}
                  value={link.label}
                  onChange={(e) => updateLinks(links.map((l, idx) => (idx === i ? { ...l, label: e.target.value } : l)))}
                />
                <Input
                  label={i === 0 ? "URL" : ""}
                  value={link.url}
                  onChange={(e) => updateLinks(links.map((l, idx) => (idx === i ? { ...l, url: e.target.value } : l)))}
                />
                <button
                  type="button"
                  onClick={() => updateLinks(links.filter((_, idx) => idx !== i))}
                  aria-label="Remove link"
                  className="mb-1 shrink-0 text-zinc-400 hover:text-red-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={() => updateLinks([...links, { label: "", url: "" }])}>
            <Plus className="mr-1 size-3.5" /> Add link
          </Button>
        </div>
      );
    }

    case "contact_bar_item":
      return (
        <div className="space-y-3">
          <Select label="Type" value={(block.settings.kind as string) ?? "text"} onChange={(e) => onUpdate("kind", e.target.value)}>
            <option value="phone">Phone (click to call)</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="text">Plain text</option>
          </Select>
          <Input
            label={(block.settings.kind as string) === "text" ? "Text" : "Number"}
            placeholder={(block.settings.kind as string) === "whatsapp" ? "9715XXXXXXXX" : "+971 5X XXX XXXX"}
            value={(block.settings.value as string) ?? ""}
            onChange={(e) => onUpdate("value", e.target.value)}
          />
          <Input
            label="Display label (optional)"
            placeholder="Falls back to the number/text above"
            value={(block.settings.label as string) ?? ""}
            onChange={(e) => onUpdate("label", e.target.value)}
          />
        </div>
      );

    case "social_row": {
      const socialLinks = (block.settings.links as { platform?: string; url?: string }[] | undefined) ?? [];
      const setLinks = (next: { platform: string; url: string }[]) => onUpdate("links", next);
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            {socialLinks.map((link, i) => (
              <div key={i} className="flex items-end gap-1.5">
                <Select
                  label={i === 0 ? "Platform" : ""}
                  value={link.platform ?? "instagram"}
                  onChange={(e) => setLinks(socialLinks.map((l, idx) => (idx === i ? { platform: e.target.value, url: l.url ?? "" } : { platform: l.platform ?? "", url: l.url ?? "" })))}
                >
                  {["instagram", "facebook", "twitter", "x", "youtube", "tiktok", "snapchat", "linkedin"].map((p) => (
                    <option key={p} value={p}>
                      {p[0].toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </Select>
                <Input
                  label={i === 0 ? "URL" : ""}
                  value={link.url ?? ""}
                  onChange={(e) => setLinks(socialLinks.map((l, idx) => (idx === i ? { platform: l.platform ?? "", url: e.target.value } : { platform: l.platform ?? "", url: l.url ?? "" })))}
                />
                <button
                  type="button"
                  onClick={() => setLinks(socialLinks.filter((_, idx) => idx !== i).map((l) => ({ platform: l.platform ?? "", url: l.url ?? "" })))}
                  aria-label="Remove link"
                  className="mb-1 shrink-0 text-zinc-400 hover:text-red-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setLinks([...socialLinks.map((l) => ({ platform: l.platform ?? "", url: l.url ?? "" })), { platform: "instagram", url: "" }])}>
            <Plus className="mr-1 size-3.5" /> Add link
          </Button>
        </div>
      );
    }

    case "language_switcher":
      return (
        <p className="text-xs text-zinc-500">
          Placeholder — shows a language menu on the storefront once multi-language support ships. No configuration yet.
        </p>
      );

    case "collection_header":
    case "product_card":
      return <p className="text-xs text-zinc-500">Contains the blocks below — use the eye icon to show/hide the whole group.</p>;

    case "product_media":
    case "product_title":
    case "product_price":
      return <p className="text-xs text-zinc-500">Shows live product data — use the eye icon to show or hide it on every card.</p>;

    default:
      return null;
  }
}
