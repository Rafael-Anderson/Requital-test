"use client";

import { useState } from "react";
import { GripVertical, Star, X } from "lucide-react";
import { resolveImageUrl, uploadProductImage } from "@/lib/api";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { useToast } from "@/components/ui/Toast";

export interface GalleryImage {
  url: string;
  order: number;
}

// Multi-image gallery with drag-to-reorder — no existing component in this
// app supports more than one image (ImageDropzone is strictly single-image,
// confirmed before building this), so the grid/reorder/remove UI here is new;
// the actual upload still goes through the same ImageDropzone + /products/upload
// pipeline Theme/Bio Links already use, just called once per added file.
// Position 0 is always the featured image (synced to product.thumbnail
// server-side) — reordering the grid changes which image that is.
export default function ProductMediaGallery({
  images,
  onChange,
}: {
  images: GalleryImage[];
  onChange: (images: GalleryImage[]) => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  async function handleAdd(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadProductImage(file);
      const next = [...images, { url: uploaded.url, order: images.length }];
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
      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Media</label>
      {images.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-3">
          {images.map((img, i) => (
            <div
              key={img.url + i}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
              className="relative group aspect-square rounded-lg border border-black/10 dark:border-white/10 overflow-hidden bg-black/5 dark:bg-white/5 cursor-grab"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resolveImageUrl(img.url) ?? ""} alt="" className="w-full h-full object-cover" />
              {i === 0 && (
                <span className="absolute top-1 left-1 inline-flex items-center gap-1 rounded-full bg-black/70 text-white px-1.5 py-0.5 text-[10px] font-medium">
                  <Star className="size-2.5 fill-current" />
                  Featured
                </span>
              )}
              <span className="absolute top-1 right-1 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical className="size-3.5" />
              </span>
              <button
                type="button"
                onClick={() => handleRemove(i)}
                aria-label="Remove image"
                className="absolute bottom-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-colors cursor-pointer"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <ImageDropzone
        preview={null}
        onFileSelected={handleAdd}
        label="Add image"
        hint={uploading ? "Uploading…" : "Drag to reorder. The first image is used as the featured thumbnail."}
      />
    </div>
  );
}
