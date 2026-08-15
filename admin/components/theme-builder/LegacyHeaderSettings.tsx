"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { resolveImageUrl, uploadThemeImage } from "@/lib/api";
import { useLegacyTheme } from "@/lib/useLegacyTheme";
import { useToast } from "@/components/ui/Toast";

// Logo + favicon from the old Theme Customizer's "Logos & Icons" card
// (app/theme/edit/site-settings/page.tsx) — only applies to a shop still
// on the classic storefront look (no new-system theme published yet); a
// published new-system theme reads its own logo/favicon from Theme
// Settings > Logo and favicon instead. Kept here rather than there because
// they're literally rendered in the header.
export default function LegacyHeaderSettings() {
  const toast = useToast();
  const { theme, saving, save } = useLegacyTheme();
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  if (!theme) return null;
  const shownLogoPreview = logoPreview ?? resolveImageUrl(theme.logoUrl);
  const shownFaviconPreview = faviconPreview ?? resolveImageUrl(theme.faviconUrl);

  async function handleSave() {
    setUploading(true);
    try {
      const [logoUrl, faviconUrl] = await Promise.all([
        logoFile ? uploadThemeImage(logoFile).then((r) => r.url) : Promise.resolve(theme!.logoUrl ?? undefined),
        faviconFile ? uploadThemeImage(faviconFile).then((r) => r.url) : Promise.resolve(theme!.faviconUrl ?? undefined),
      ]);
      const ok = await save({ logoUrl, faviconUrl });
      if (ok) {
        setLogoFile(null);
        setFaviconFile(null);
      } else {
        toast("Failed to save", "error");
      }
    } catch {
      toast("Failed to upload image", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <details className="rounded-lg border border-black/10 dark:border-white/10">
      <summary className="cursor-pointer p-3 text-sm font-medium">Classic logo &amp; favicon</summary>
      <div className="space-y-4 border-t border-black/10 p-3 dark:border-white/10">
        <p className="text-xs text-zinc-500">
          Only applies to a shop still on the classic storefront look (no new-system theme published yet).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ImageDropzone
            label="Logo"
            preview={shownLogoPreview}
            onFileSelected={(f) => {
              setLogoFile(f);
              setLogoPreview(URL.createObjectURL(f));
            }}
            hint="Square/vertical 300x150px, or horizontal 300x90px"
          />
          <ImageDropzone
            label="Favicon"
            preview={shownFaviconPreview}
            onFileSelected={(f) => {
              setFaviconFile(f);
              setFaviconPreview(URL.createObjectURL(f));
            }}
            hint="16x16px"
          />
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" loading={saving || uploading} onClick={() => void handleSave()}>
            Save
          </Button>
        </div>
      </div>
    </details>
  );
}
