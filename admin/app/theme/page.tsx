"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Palette } from "lucide-react";
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
    </PageShell>
  );
}
