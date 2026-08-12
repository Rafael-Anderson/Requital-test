"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Palette, Plus } from "lucide-react";
import { getTheme, resolveImageUrl } from "@/lib/api";
import { HOMEPAGE_LAYOUT_OPTIONS, type ThemeSettings } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import BackButton from "@/components/ui/BackButton";
import { CardSkeleton } from "@/components/ui/Skeleton";
import PageShell from "@/components/ui/PageShell";

// A "theme library" in name, but there's only ever one real theme per shop
// today — no draft/multi-theme/import system exists behind this. Rather
// than build a full library UI (draft themes, import, multiple saved
// themes) with nothing real behind it, this starts as just the current
// theme's card, matching the reference's top card specifically. Flagged
// here rather than silently treated as "the whole feature" — a real
// multi-theme system would be a much bigger, separate task.
export default function ThemeLibraryPage() {
  const [theme, setTheme] = useState<ThemeSettings | null>(null);

  useEffect(() => {
    getTheme().then(setTheme);
  }, []);

  const brandColor = theme?.brandColor ?? "#069494";
  const layoutOption = HOMEPAGE_LAYOUT_OPTIONS.find((o) => o.key === theme?.homepageLayout);
  const logoPreview = resolveImageUrl(theme?.logoUrl);

  return (
    <PageShell variant="form">
      <BackButton href="/" />
      <h1 className="text-2xl font-semibold mb-1">Theme</h1>
      <p className="text-sm text-zinc-500 mb-6">Your storefront's current look, content, and layout.</p>

      {/* Grid, not a single wide card — a real multi-theme library still
          doesn't exist behind this (see the comment above), but the layout
          itself now has room for more than the one current theme: the "Add
          theme" placeholder always fills the second column today, and a
          future second real theme would land there instead. Grid's default
          align-items: stretch keeps both cards the same height with no
          hardcoded value to keep in sync. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {!theme ? (
          <CardSkeleton />
        ) : (
          <Card className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div
              className="size-20 rounded-lg shrink-0 flex items-center justify-center overflow-hidden"
              style={{ background: `${brandColor}1a` }}
            >
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="" className="max-w-full max-h-full object-contain p-2" />
              ) : (
                <Palette className="size-8" style={{ color: brandColor }} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-medium">Current theme</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-xs font-medium">
                  <Check className="size-3" />
                  Active
                </span>
              </div>
              <p className="text-sm text-zinc-500">
                {layoutOption?.label ?? "Classic"} layout
                {theme.updatedAt && ` (last saved ${new Date(theme.updatedAt).toLocaleString()})`}
              </p>
            </div>

            <Link href="/theme/edit" className="shrink-0">
              <Button variant="primary">Edit theme</Button>
            </Link>
          </Card>
        )}

        {/* Placeholder only — no theme library to browse/add from yet, see
            the comment above. */}
        <button
          type="button"
          className="rounded-lg border-2 border-dashed border-black/15 dark:border-white/15 flex flex-col items-center justify-center gap-2 p-5 text-zinc-500 hover:border-black/30 dark:hover:border-white/30 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors cursor-pointer"
        >
          <Plus className="size-6" />
          <span className="text-sm font-medium">Add theme</span>
        </button>
      </div>
    </PageShell>
  );
}
