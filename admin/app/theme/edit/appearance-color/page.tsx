"use client";

import { useEffect, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { getTheme, updateTheme } from "@/lib/api";
import { THEME_COLOR_DEFAULTS, THEME_COLOR_FIELDS, THEME_COLOR_GROUPS, type ThemeSettings } from "@/lib/types";
import { getReadableTextColor, getContrastWarning } from "@/lib/color-contrast";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";
import ColorInput from "@/components/ui/ColorInput";

export default function ThemeAppearanceColorPage() {
  const toast = useToast();
  const [theme, setTheme] = useState<ThemeSettings | null>(null);
  const [colors, setColors] = useState<Record<string, string>>({});
  // Primary/secondary — the actual --color-accent/--color-accent-hover
  // pair every other color on the storefront derives from when unset (see
  // shop-context.tsx's resolveThemeCssVars). Previously stored on
  // themesettings.brandColor/secondaryColor and read by the storefront, but
  // had no admin UI of its own to set them from — Theme Customizer v2 adds
  // that UI; the underlying free-hex-picker storage was already there.
  const [brandColor, setBrandColor] = useState("#069494");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getTheme().then((data) => {
      setTheme(data);
      setColors(data.colors ?? {});
      setBrandColor(data.brandColor ?? "#069494");
      setSecondaryColor(data.secondaryColor ?? "");
    });
  }, []);

  function setColor(key: string, value: string) {
    setColors((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Drops any key no longer in THEME_COLOR_FIELDS (e.g. a shop that
      // saved a color for a field since removed — see the storefront
      // layout/dead-settings pass) before sending — the backend rejects
      // the whole save on an unknown key (ThemeService.assertValidColors),
      // which would otherwise permanently block that shop from saving any
      // further Appearance Color change.
      const validKeys = new Set(THEME_COLOR_FIELDS.map((f) => f.key));
      const validColors = Object.fromEntries(Object.entries(colors).filter(([key]) => validKeys.has(key)));
      await updateTheme({ colors: validColors, brandColor, secondaryColor: secondaryColor || undefined });
      toast("Appearance colors saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save colors", "error");
    } finally {
      setSaving(false);
    }
  }

  const brandContrastWarning = getContrastWarning(brandColor);
  const brandTextColor = getReadableTextColor(brandColor);

  if (!theme) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const headerBg = colors.headerBackgroundColor ?? THEME_COLOR_DEFAULTS.headerBackgroundColor;
  const headerFg = colors.headerTextColor ?? THEME_COLOR_DEFAULTS.headerTextColor;
  const addToCartBg = colors.addToCartButtonColor ?? THEME_COLOR_DEFAULTS.addToCartButtonColor;
  const addToCartFg = colors.addToCartTextColor || getReadableTextColor(addToCartBg);
  const priceColor = colors.priceMainColor ?? THEME_COLOR_DEFAULTS.priceMainColor;
  const nameColor = colors.productNameColor ?? THEME_COLOR_DEFAULTS.productNameColor;

  return (
    <PageShell>
      <div className="space-y-6">
        <Card>
          <h3 className="text-sm font-semibold text-accent-text dark:text-accent mb-1">Brand Colors</h3>
          <p className="text-xs text-zinc-400 mb-3">
            Your primary color drives the storefront's buttons and accents everywhere below that isn't overridden
            individually.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm">Primary color</p>
                <p className="text-xs text-zinc-400">Any color — not a locked palette.</p>
              </div>
              <ColorInput value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm">Secondary color</p>
                <p className="text-xs text-zinc-400">Optional — derived from primary if unset.</p>
              </div>
              <ColorInput value={secondaryColor || brandColor} onChange={(e) => setSecondaryColor(e.target.value)} />
            </div>
          </div>
          {brandContrastWarning && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{brandContrastWarning}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-zinc-400">Button text auto-picks for contrast:</span>
            <span
              className="inline-flex items-center h-6 px-2 rounded text-xs font-medium"
              style={{ background: brandColor, color: brandTextColor }}
            >
              Sample
            </span>
          </div>
        </Card>

        <div className="columns-1 gap-4 lg:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {THEME_COLOR_GROUPS.map((group) => (
            <Card key={group.key}>
              <h3 className="text-sm font-semibold text-accent-text dark:text-accent mb-1">{group.label}</h3>
              <div className="divide-y divide-black/5 dark:divide-white/5">
                {THEME_COLOR_FIELDS.filter((f) => f.group === group.key).map((field) => (
                  <div key={field.key} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{field.label}</p>
                      {!field.wired && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">Not yet visible on your storefront</p>
                      )}
                    </div>
                    <ColorInput
                      value={colors[field.key] ?? THEME_COLOR_DEFAULTS[field.key]}
                      onChange={(e) => setColor(field.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        {/* Right after the color-editing Cards, not after Live Preview below —
          this is the actual editing area a merchant just finished using;
          Live Preview is reference material for the change they're about to
          save, not a reason to make them scroll further to save it. */}
        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>

        <div>
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Live preview</p>
          <div className="max-w-sm rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ background: headerBg, color: headerFg }}
            >
              <span className="font-semibold">Your Shop</span>
              <ShoppingCart className="size-4" />
            </div>
            <div className="p-4 bg-white">
              <div className="rounded-lg border border-black/10 p-3 max-w-[180px]">
                <div className="aspect-square rounded-md bg-black/5 mb-2" />
                <p className="text-sm font-medium" style={{ color: nameColor }}>
                  Sample Product
                </p>
                <p className="text-xs mb-2" style={{ color: priceColor }}>
                  49.00 AED
                </p>
                <button
                  type="button"
                  className="w-full h-8 rounded-md text-xs font-medium"
                  style={{ background: addToCartBg, color: addToCartFg }}
                >
                  Add to cart
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
