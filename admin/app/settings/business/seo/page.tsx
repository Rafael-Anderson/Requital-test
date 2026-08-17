"use client";

import { useEffect, useState } from "react";
import { getSeo, resolveImageUrl, updateSeo, uploadSeoImage } from "@/lib/api";
import type { SeoSettings } from "@/lib/types";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import ImageDropzone from "@/components/ui/ImageDropzone";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

export default function SeoSettingsPage() {
  const toast = useToast();

  const [seo, setSeo] = useState<SeoSettings | null>(null);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [ogImageFile, setOgImageFile] = useState<File | null>(null);
  const [ogImagePreview, setOgImagePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSeo().then((data) => {
      setSeo(data);
      setMetaTitle(data.metaTitle ?? "");
      setMetaDescription(data.metaDescription ?? "");
      setKeywords(data.keywords ?? "");
      setOgImagePreview(resolveImageUrl(data.ogImage));
    });
  }, []);

  function handleOgImageSelected(file: File) {
    setOgImageFile(file);
    setOgImagePreview(URL.createObjectURL(file));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const ogImage = ogImageFile ? (await uploadSeoImage(ogImageFile)).url : (seo?.ogImage ?? undefined);
      await updateSeo({
        metaTitle: metaTitle || undefined,
        metaDescription: metaDescription || undefined,
        keywords: keywords || undefined,
        ogImage,
      });
      toast("SEO settings saved");
      setOgImageFile(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save SEO settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!seo) return <p className="text-sm text-text-muted">Loading…</p>;

  return (
    <PageShell variant="form">
      <div className="space-y-4">
      <Card className="space-y-4">
        <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Search & social preview</h3>
        <p className="text-xs text-text-faint">
          Controls what shows up in Google search results and when a link to your storefront is shared on
          WhatsApp, Instagram, etc. Falls back to your shop name if left blank.
        </p>
        <Input
          label="Meta title"
          value={metaTitle}
          onChange={(e) => setMetaTitle(e.target.value)}
          placeholder="Your Shop Name: Flowers & Gifts in Dubai"
          maxLength={255}
        />
        <Textarea
          label="Meta description"
          value={metaDescription}
          onChange={(e) => setMetaDescription(e.target.value)}
          placeholder="Same-day flower and gift delivery across Dubai."
          maxLength={500}
        />
        <ImageDropzone
          label="Social share image (Open Graph)"
          preview={ogImagePreview}
          onFileSelected={handleOgImageSelected}
        />
        <p className="text-xs text-text-faint -mt-2">
          Falls back to your Theme banner or logo if left unset. Never blank on a shared link.
        </p>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Keywords</h3>
        <p className="text-xs text-text-faint">
          Low impact on modern search rankings, but included for parity. Comma-separated, optional.
        </p>
        <Input
          label="Keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="flowers, gifts, dubai, same-day delivery"
        />
      </Card>

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </Button>
      </div>
    </PageShell>
  );
}
