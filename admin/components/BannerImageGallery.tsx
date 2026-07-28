"use client";

import { useState } from "react";
import { GripVertical, X } from "lucide-react";
import { resolveImageUrl, uploadThemeImage } from "@/lib/api";
import type { BannerImage } from "@/lib/types";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { useToast } from "@/components/ui/Toast";

// Mirrors ProductMediaGallery's drag-to-reorder/add/remove shape (see that
// component's own comment — no existing component supported more than one
// image before it was built) plus one addition: each slide can carry its
// own optional CTA link, since a slideshow slide (unlike a product photo)
// is often meant to be clicked through to a collection/promo.
export default function BannerImageGallery({
  images,
  onChange,
}: {
  images: BannerImage[];
  onChange: (images: BannerImage[]) => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  async function handleAdd(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadThemeImage(file);
      const next = [...images, { url: uploaded.url, linkUrl: "", order: images.length }];
      onChange(next.map((img, i) => ({ ...img, order: i })));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to upload image", "error");
    } finally {
      setUploading(false);
    }
  }

  function handleRemove(index: number) {
    const next = images.filter((_, i) => i !== index).map((img, i) => ({ ...img, order: i }));
    onChange(next);
  }

  function handleLinkChange(index: number, linkUrl: string) {
    onChange(images.map((img, i) => (i === index ? { ...img, linkUrl } : img)));
  }

  function handleDrop(index: number) {
    if (dragIndex === null || dragIndex === index) return;
    const next = [...images];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    onChange(next.map((img, i) => ({ ...img, order: i })));
    setDragIndex(null);
  }

  return (
    <div>
      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
        Homepage Banners
      </label>
      {images.length > 0 && (
        <div className="space-y-2 mb-3">
          {images.map((img, i) => (
            <div
              key={`${img.id ?? img.url}-${i}`}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
              className="flex items-center gap-3 rounded-lg border border-black/10 dark:border-white/10 p-2 cursor-grab"
            >
              <span className="text-zinc-400 shrink-0">
                <GripVertical className="size-4" />
              </span>
              <div className="size-14 shrink-0 rounded-md overflow-hidden bg-black/5 dark:bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resolveImageUrl(img.url) ?? ""} alt="" className="w-full h-full object-cover" />
              </div>
              <input
                value={img.linkUrl ?? ""}
                onChange={(e) => handleLinkChange(i, e.target.value)}
                placeholder="Optional link (e.g. /collections/sale) — leave blank for no click-through"
                className="flex-1 h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 text-sm outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/20"
              />
              <button
                type="button"
                onClick={() => handleRemove(i)}
                aria-label="Remove banner"
                className="p-1.5 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer shrink-0"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <ImageDropzone
        preview={null}
        onFileSelected={handleAdd}
        label="Add banner image"
        hint={
          uploading
            ? "Uploading…"
            : "Drag to reorder — cycles as a slideshow on the \"Slideshow\" homepage layout. Recommended size: 1600 x 500px."
        }
      />
    </div>
  );
}
