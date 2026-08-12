"use client";

import { useState } from "react";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import ColorPicker from "@/components/ui/ColorPicker";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { uploadThemeImage, resolveImageUrl } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

export interface BackgroundValue {
  type?: "solid" | "gradient" | "image";
  color?: string;
  gradientFrom?: string;
  gradientTo?: string;
  imageUrl?: string;
}

// Reuses the legacy theme module's generic /theme/upload endpoint
// (StorageService.uploadImage) — no new upload plumbing needed, same call
// the site-settings tab already makes for logo/favicon/banner images.
export default function BackgroundControls({
  value,
  onChange,
}: {
  value: BackgroundValue | undefined;
  onChange: (next: BackgroundValue) => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const v = value ?? {};
  const type = v.type ?? "solid";

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const { url } = await uploadThemeImage(file);
      onChange({ ...v, imageUrl: url });
    } catch {
      toast("Failed to upload image", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Background</span>
      <SegmentedToggle
        value={type}
        options={[
          { value: "solid", label: "Solid" },
          { value: "gradient", label: "Gradient" },
          { value: "image", label: "Image" },
        ]}
        onChange={(next) => onChange({ ...v, type: next as BackgroundValue["type"] })}
      />

      {type === "solid" && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">Color</span>
          <ColorPicker value={v.color ?? "#ffffff"} onChange={(hex) => onChange({ ...v, color: hex })} />
        </div>
      )}

      {type === "gradient" && (
        <div className="flex items-center gap-4">
          <div className="flex flex-1 items-center justify-between">
            <span className="text-sm text-zinc-500">From</span>
            <ColorPicker
              value={v.gradientFrom ?? "#ffffff"}
              onChange={(hex) => onChange({ ...v, gradientFrom: hex })}
            />
          </div>
          <div className="flex flex-1 items-center justify-between">
            <span className="text-sm text-zinc-500">To</span>
            <ColorPicker
              value={v.gradientTo ?? "#069494"}
              onChange={(hex) => onChange({ ...v, gradientTo: hex })}
            />
          </div>
        </div>
      )}

      {type === "image" && (
        <ImageDropzone
          preview={resolveImageUrl(v.imageUrl ?? null)}
          onFileSelected={(file) => void handleFile(file)}
          label={uploading ? "Uploading..." : "Background image"}
        />
      )}
    </div>
  );
}
