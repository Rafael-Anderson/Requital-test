"use client";

import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { uploadThemeImage, resolveImageUrl } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useState } from "react";
import TypographyControls, { type TypographyValue } from "./shared/TypographyControls";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { ScrollAnimation, SectionVisibility } from "@/lib/types";

export default function ImageTextSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
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
        preview={resolveImageUrl((settings.imageUrl as string) ?? null)}
        onFileSelected={(file) => void handleImage(file)}
        label={uploading ? "Uploading..." : "Image"}
      />
      <SegmentedToggle
        value={(settings.imagePosition as string) ?? "left"}
        options={[
          { value: "left", label: "Image left" },
          { value: "right", label: "Image right" },
        ]}
        onChange={(v) => onUpdate("imagePosition", v)}
      />
      <Input
        label="Heading"
        value={(settings.heading as string) ?? ""}
        onChange={(e) => onUpdate("heading", e.target.value)}
      />
      <Textarea
        label="Text"
        rows={4}
        value={(settings.text as string) ?? ""}
        onChange={(e) => onUpdate("text", e.target.value)}
      />

      <hr className="border-black/10 dark:border-white/10" />

      <TypographyControls
        value={settings.typography as TypographyValue}
        onChange={(v) => onUpdate("typography", v)}
      />
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
