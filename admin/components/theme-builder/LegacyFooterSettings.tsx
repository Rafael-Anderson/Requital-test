"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Checkbox from "@/components/ui/Checkbox";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { getShop, resolveImageUrl, uploadThemeImage, updateShop } from "@/lib/api";
import { useLegacyTheme } from "@/lib/useLegacyTheme";
import { useToast } from "@/components/ui/Toast";

// Footer logo/description from the old Theme Customizer's "Logos & Icons"/
// "Footer" cards, plus Contact Email/Number(s) from its "Site Settings"
// card — grouped here because they're all rendered in the storefront
// footer's Contact Us / brand columns (see storefront/components/Footer.tsx).
// Only applies to a shop still on the classic storefront look; a published
// new-system theme's footer copyright/columns come from the Footer node's
// own blocks in the tree instead.
export default function LegacyFooterSettings() {
  const toast = useToast();
  const { theme, saving, save } = useLegacyTheme();
  const [footerLogoFile, setFooterLogoFile] = useState<File | null>(null);
  const [footerLogoPreview, setFooterLogoPreview] = useState<string | null>(null);
  const [footerDescription, setFooterDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [showMultipleNumbers, setShowMultipleNumbers] = useState(false);
  const [contactNumbers, setContactNumbers] = useState<string[]>([""]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!theme) return;
    setFooterDescription(theme.footerDescription ?? "");
    const numbers = theme.contactNumbers?.length ? theme.contactNumbers : [""];
    setContactNumbers(numbers);
    setShowMultipleNumbers(numbers.length > 1);
  }, [theme]);

  useEffect(() => {
    getShop()
      .then((shop) => setContactEmail(shop.email ?? ""))
      .catch(() => {});
  }, []);

  if (!theme) return null;
  const shownFooterLogoPreview = footerLogoPreview ?? resolveImageUrl(theme.footerLogoUrl);

  async function handleSave() {
    setUploading(true);
    try {
      const footerLogoUrl = footerLogoFile
        ? await uploadThemeImage(footerLogoFile).then((r) => r.url)
        : (theme!.footerLogoUrl ?? undefined);
      const cleanedNumbers = (showMultipleNumbers ? contactNumbers : contactNumbers.slice(0, 1))
        .map((n) => n.trim())
        .filter(Boolean);
      const [ok] = await Promise.all([
        save({
          footerLogoUrl,
          footerDescription: footerDescription.trim() || undefined,
          contactNumbers: cleanedNumbers,
        }),
        updateShop({ email: contactEmail.trim() || undefined }),
      ]);
      if (ok) setFooterLogoFile(null);
      else toast("Failed to save", "error");
    } catch {
      toast("Failed to save", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <details className="rounded-lg border border-black/10 dark:border-white/10">
      <summary className="cursor-pointer p-3 text-sm font-medium">Classic footer &amp; contact info</summary>
      <div className="space-y-4 border-t border-black/10 p-3 dark:border-white/10">
        <p className="text-xs text-zinc-500">
          Only applies to a shop still on the classic storefront look (no new-system theme published yet).
        </p>
        <ImageDropzone
          label="Footer logo"
          preview={shownFooterLogoPreview}
          onFileSelected={(f) => {
            setFooterLogoFile(f);
            setFooterLogoPreview(URL.createObjectURL(f));
          }}
          hint="Falls back to your regular logo if left unset"
        />
        <Textarea
          label="Footer description"
          value={footerDescription}
          onChange={(e) => setFooterDescription(e.target.value)}
          rows={3}
          placeholder="A short line about your shop, shown under your logo in the footer."
        />
        <Input label="Contact email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="hello@yourshop.com" />
        <div>
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Contact number</label>
          <div className="space-y-2">
            {(showMultipleNumbers ? contactNumbers : contactNumbers.slice(0, 1)).map((number, i) => (
              <input
                key={i}
                value={number}
                onChange={(e) => setContactNumbers((prev) => prev.map((n, idx) => (idx === i ? e.target.value : n)))}
                placeholder="+1-555-123-4567"
                className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Checkbox
              label="Show multiple numbers"
              checked={showMultipleNumbers}
              onChange={(e) => {
                const checked = e.target.checked;
                setShowMultipleNumbers(checked);
                if (checked) setContactNumbers((prev) => (prev.length > 1 ? prev : [...prev, ""]));
              }}
            />
            {showMultipleNumbers && (
              <button
                type="button"
                onClick={() => setContactNumbers((prev) => [...prev, ""])}
                className="text-xs text-accent-text dark:text-accent hover:underline cursor-pointer"
              >
                + Add another number
              </button>
            )}
          </div>
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
