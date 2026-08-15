"use client";

import { useState } from "react";
import ImageDropzone from "@/components/ui/ImageDropzone";
import Slider from "@/components/ui/Slider";
import { uploadThemeImage, resolveImageUrl } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

export default function LogoSettings({ editor }: { editor: ThemeEditorState }) {
  const toast = useToast();
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const logo = editor.config!.globalSettings.logo;

  async function handleUpload(key: "defaultLogoUrl" | "inverseLogoUrl" | "faviconUrl", file: File) {
    setUploadingKey(key);
    try {
      const { url } = await uploadThemeImage(file);
      editor.updateGlobalSettingsCategory("logo", { [key]: url });
    } catch {
      toast("Failed to upload image", "error");
    } finally {
      setUploadingKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <ImageDropzone
        label={uploadingKey === "defaultLogoUrl" ? "Uploading..." : "Logo"}
        preview={resolveImageUrl(logo.defaultLogoUrl ?? null)}
        onFileSelected={(file) => void handleUpload("defaultLogoUrl", file)}
      />
      <ImageDropzone
        label={uploadingKey === "inverseLogoUrl" ? "Uploading..." : "Inverse logo"}
        hint="Shown on a dark/transparent header (e.g. transparent-over-hero)"
        preview={resolveImageUrl(logo.inverseLogoUrl ?? null)}
        onFileSelected={(file) => void handleUpload("inverseLogoUrl", file)}
      />
      <ImageDropzone
        label={uploadingKey === "faviconUrl" ? "Uploading..." : "Favicon"}
        preview={resolveImageUrl(logo.faviconUrl ?? null)}
        onFileSelected={(file) => void handleUpload("faviconUrl", file)}
      />
      <Slider
        label="Desktop logo height"
        min={16}
        max={80}
        suffix="px"
        value={logo.desktopHeight}
        onChange={(v) => editor.updateGlobalSettingsCategory("logo", { desktopHeight: v })}
      />
      <Slider
        label="Mobile logo height"
        min={12}
        max={60}
        suffix="px"
        value={logo.mobileHeight}
        onChange={(v) => editor.updateGlobalSettingsCategory("logo", { mobileHeight: v })}
      />
    </div>
  );
}
