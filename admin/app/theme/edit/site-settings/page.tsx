"use client";

import { useEffect, useState } from "react";
import { getShop, getTheme, resolveImageUrl, updateShop, updateTheme, uploadThemeImage } from "@/lib/api";
import type { BannerImage, Shop, ThemeSettings } from "@/lib/types";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Checkbox from "@/components/ui/Checkbox";
import Toggle from "@/components/ui/Toggle";
import Button from "@/components/ui/Button";
import ImageDropzone from "@/components/ui/ImageDropzone";
import BannerImageGallery from "@/components/BannerImageGallery";
import HeaderFooterPreview from "@/components/HeaderFooterPreview";
import TagInput from "@/components/ui/TagInput";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

export default function ThemeSiteSettingsPage() {
  const toast = useToast();

  const [shop, setShop] = useState<Shop | null>(null);
  const [theme, setTheme] = useState<ThemeSettings | null>(null);

  const [siteTitle, setSiteTitle] = useState("");
  const [siteDescription, setSiteDescription] = useState("");
  const [notificationText, setNotificationText] = useState<string[]>([]);
  const [announcementBarEnabled, setAnnouncementBarEnabled] = useState(false);
  const [announcementBarScrolling, setAnnouncementBarScrolling] = useState(false);
  const [showMultipleNumbers, setShowMultipleNumbers] = useState(false);
  const [contactNumbers, setContactNumbers] = useState<string[]>([""]);
  // Footer's Contact Us column (storefront/components/Footer.tsx) shows this
  // alongside contactNumbers — previously only editable indirectly via
  // Business Information's own Email field with no way to see/change it from
  // here, where the rest of the footer's contact-facing content lives.
  const [contactEmail, setContactEmail] = useState("");
  // Was saved but had no admin input anywhere (confirmed via search before
  // adding this) — the storefront's home-layout components already read
  // heroText as the hero/banner subtitle, so this surfaces the existing
  // field rather than adding a new duplicate one (see the task's own
  // "check for overlap first" instruction).
  const [heroText, setHeroText] = useState("");
  const [footerDescription, setFooterDescription] = useState("");
  const [bannerImages, setBannerImages] = useState<BannerImage[]>([]);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [footerLogoFile, setFooterLogoFile] = useState<File | null>(null);
  const [footerLogoPreview, setFooterLogoPreview] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getShop(), getTheme()]).then(([shopRes, themeRes]) => {
      setShop(shopRes);
      setTheme(themeRes);
      // Site Title / Site Description map onto shop.displayName/description
      // (already the storefront-facing name/description override, edited on
      // Business Information too) rather than new theme-only fields — Theme
      // groups them here because they're "what customers see," but there's
      // only one underlying value, edited from either page.
      setSiteTitle(shopRes.displayName ?? "");
      setSiteDescription(shopRes.description ?? "");
      setContactEmail(shopRes.email ?? "");
      setNotificationText(themeRes.notificationText ?? []);
      setAnnouncementBarEnabled(themeRes.announcementBarEnabled);
      setAnnouncementBarScrolling(themeRes.announcementBarScrolling);
      const numbers = themeRes.contactNumbers?.length ? themeRes.contactNumbers : [""];
      setContactNumbers(numbers);
      setShowMultipleNumbers(numbers.length > 1);
      setHeroText(themeRes.heroText ?? "");
      setFooterDescription(themeRes.footerDescription ?? "");
      setBannerImages(themeRes.images ?? []);
      setLogoPreview(resolveImageUrl(themeRes.logoUrl));
      setFaviconPreview(resolveImageUrl(themeRes.faviconUrl));
      setFooterLogoPreview(resolveImageUrl(themeRes.footerLogoUrl));
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const [logoUrl, faviconUrl, footerLogoUrl] = await Promise.all([
        logoFile ? uploadThemeImage(logoFile).then((r) => r.url) : Promise.resolve(theme?.logoUrl ?? undefined),
        faviconFile ? uploadThemeImage(faviconFile).then((r) => r.url) : Promise.resolve(theme?.faviconUrl ?? undefined),
        footerLogoFile
          ? uploadThemeImage(footerLogoFile).then((r) => r.url)
          : Promise.resolve(theme?.footerLogoUrl ?? undefined),
      ]);
      const cleanedNumbers = (showMultipleNumbers ? contactNumbers : contactNumbers.slice(0, 1))
        .map((n) => n.trim())
        .filter(Boolean);

      await Promise.all([
        updateShop({ displayName: siteTitle, description: siteDescription, email: contactEmail.trim() || undefined }),
        updateTheme({
          logoUrl,
          faviconUrl,
          footerLogoUrl,
          heroText: heroText.trim() || undefined,
          footerDescription: footerDescription.trim() || undefined,
          notificationText,
          announcementBarEnabled,
          announcementBarScrolling,
          contactNumbers: cleanedNumbers,
          images: bannerImages.map(({ url, linkUrl, order }) => ({
            url,
            linkUrl: linkUrl || undefined,
            order,
          })),
        }),
      ]);
      toast("Site settings saved");
      setLogoFile(null);
      setFaviconFile(null);
      setFooterLogoFile(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save site settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!shop || !theme) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <PageShell>
      <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-semibold mb-1">Header &amp; Footer Preview</h3>
        <p className="text-xs text-text-faint mb-4">
          Reflects your logo, announcement bar, and footer content as you edit below. Colors and layout come from
          Appearance Color and Theme &gt; Advanced.
        </p>
        <HeaderFooterPreview
          logoPreview={logoPreview}
          shopName={siteTitle || shop.name}
          notificationText={notificationText}
          announcementBarEnabled={announcementBarEnabled}
          announcementBarScrolling={announcementBarScrolling}
          footerDescription={footerDescription}
          footerLogoPreview={footerLogoPreview}
          colors={theme.colors ?? {}}
        />
      </Card>

      {/* Side by side at lg+ (same grid-cols-1 lg:grid-cols-2 pattern as the
          appearance-color live preview split) rather than stacked full-width.
          items-start keeps each column at its own natural height instead of
          stretching the shorter one to match. Logos & Icons, Footer, and
          Homepage Content are grouped into their own right-column stack (not
          plain grid siblings) so Footer renders directly beneath Logos &
          Icons — 4 flat siblings in a 2-col grid would auto-flow Footer under
          the left card instead, diagonal from Logos & Icons rather than
          under it. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card className="space-y-4">
          <Input label="Site Title" value={siteTitle} onChange={(e) => setSiteTitle(e.target.value)} placeholder="My Amazing Store" />
          <Textarea
            label="Site Description"
            value={siteDescription}
            onChange={(e) => setSiteDescription(e.target.value)}
            rows={4}
          />
          <div>
            <label className="text-sm font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">
              Site Header Notification Text
            </label>
            <TagInput tags={notificationText} onChange={setNotificationText} />
            <p className="mt-1.5 text-xs text-text-faint">Shown as an announcement bar above the storefront header.</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <Toggle checked={announcementBarEnabled} onChange={setAnnouncementBarEnabled} />
                <span className="text-sm">Show announcement bar</span>
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked={announcementBarScrolling} onChange={setAnnouncementBarScrolling} />
                <span className="text-sm">Scroll continuously (marquee)</span>
              </div>
            </div>
            {announcementBarEnabled && notificationText.length === 0 && (
              <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                Add at least one message above. An empty bar never shows even when this is on.
              </p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">Contact Number</label>
            <div className="space-y-2">
              {(showMultipleNumbers ? contactNumbers : contactNumbers.slice(0, 1)).map((number, i) => (
                <input
                  key={i}
                  value={number}
                  onChange={(e) =>
                    setContactNumbers((prev) => prev.map((n, idx) => (idx === i ? e.target.value : n)))
                  }
                  placeholder="+1-555-123-4567"
                  className="flex h-9 w-full rounded-lg border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
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
          <Input
            label="Contact Email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="hello@yourshop.com"
          />
        </Card>

        <div className="flex flex-col gap-4">
        <Card>
          <h3 className="text-sm font-semibold mb-4">Logos &amp; Icons</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ImageDropzone
              label="Logo (Theme Only)"
              preview={logoPreview}
              onFileSelected={(f) => {
                setLogoFile(f);
                setLogoPreview(URL.createObjectURL(f));
              }}
              hint="Recommended size: Square/Vertical logo 300 x 150 px, Horizontal logo 300 x 90 px (WxH)"
            />
            <ImageDropzone
              label="Favicon"
              preview={faviconPreview}
              onFileSelected={(f) => {
                setFaviconFile(f);
                setFaviconPreview(URL.createObjectURL(f));
              }}
              hint="Recommended size: 16 x 16 px (Width x Height)"
            />
            <div>
              <ImageDropzone
                label="Footer Logo"
                preview={footerLogoPreview}
                onFileSelected={(f) => {
                  setFooterLogoFile(f);
                  setFooterLogoPreview(URL.createObjectURL(f));
                }}
                hint="Recommended size: Square/Vertical logo 300 x 150 px, Horizontal logo 300 x 90 px (WxH)"
              />
              <p className="mt-1.5 text-xs text-text-faint">Shown in the footer&apos;s brand column. Falls back to your regular logo if left unset.</p>
            </div>
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-1">Footer</h3>
            <p className="text-xs text-text-faint">Shown in the footer&apos;s brand column, alongside your logo and TRN (if set).</p>
          </div>
          <Textarea
            label="Footer Description"
            value={footerDescription}
            onChange={(e) => setFooterDescription(e.target.value)}
            rows={3}
            placeholder="A short line about your shop, shown under your logo in the footer."
          />
        </Card>

        <Card className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-1">Homepage Content</h3>
            <p className="text-xs text-text-faint">Used by the Classic and Slideshow homepage layouts (see Theme &gt; Advanced).</p>
          </div>
          <Input
            label="Hero / Banner Text"
            value={heroText}
            onChange={(e) => setHeroText(e.target.value)}
            placeholder="Fresh flowers, delivered same-day"
          />
          <BannerImageGallery images={bannerImages} onChange={setBannerImages} />
        </Card>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      </div>
    </PageShell>
  );
}
