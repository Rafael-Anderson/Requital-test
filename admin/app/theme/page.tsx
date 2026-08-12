"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Palette, Plus, Trash2 } from "lucide-react";
import { getTheme, resolveImageUrl, listThemes, createTheme, deleteTheme } from "@/lib/api";
import { HOMEPAGE_LAYOUT_OPTIONS, type ThemeSettings, type ThemeListItem } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import BackButton from "@/components/ui/BackButton";
import { CardSkeleton } from "@/components/ui/Skeleton";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";

// Two systems, deliberately not merged: the "Current theme" card below still
// edits the legacy themesettings-backed site-settings/appearance-color/
// advanced tabs (PDP/cart/checkout layout, etc. — out of the new builder's
// scope). "Custom themes" is the new section-based visual builder — a real
// library now (create/publish/delete), replacing the single dashed "Add
// theme" placeholder this page used to ship with no feature behind it.
// Available to every shop immediately, not gated behind any flag.
export default function ThemeLibraryPage() {
  const router = useRouter();
  const toast = useToast();
  const [theme, setTheme] = useState<ThemeSettings | null>(null);
  const [themes, setThemes] = useState<ThemeListItem[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getTheme().then(setTheme);
    refreshThemes();
  }, []);

  function refreshThemes() {
    listThemes()
      .then(setThemes)
      .catch(() => setThemes([]));
  }

  const brandColor = theme?.brandColor ?? "#069494";
  const layoutOption = HOMEPAGE_LAYOUT_OPTIONS.find((o) => o.key === theme?.homepageLayout);
  const logoPreview = resolveImageUrl(theme?.logoUrl);

  async function handleAddTheme() {
    setCreating(true);
    try {
      const created = await createTheme({ name: `Theme ${(themes?.length ?? 0) + 1}` });
      router.push(`/theme/${created.id}/builder`);
    } catch {
      toast("Failed to create theme", "error");
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteTheme(id);
      toast("Theme deleted", "success");
      refreshThemes();
    } catch {
      toast("Failed to delete theme", "error");
    }
  }

  return (
    <PageShell variant="form">
      <BackButton href="/" />
      <h1 className="text-2xl font-semibold mb-1">Theme</h1>
      <p className="text-sm text-zinc-500 mb-6">Your storefront's current look, content, and layout.</p>

      {!theme ? (
        <CardSkeleton />
      ) : (
        <Card className="flex flex-col sm:flex-row items-start sm:items-center gap-5 mb-8">
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

      <h2 className="text-lg font-semibold mb-1">Custom themes</h2>
      <p className="text-sm text-zinc-500 mb-4">
        Build a section-based homepage with the visual editor. Publishing a custom theme takes over your
        homepage, header, and footer.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {themes === null ? (
          <CardSkeleton />
        ) : (
          themes.map((t) => (
            <Card key={t.id} className="flex items-center gap-4">
              <div className="size-12 rounded-lg shrink-0 flex items-center justify-center bg-accent/10">
                <Palette className="size-5 text-accent-text dark:text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium truncate">{t.name}</h3>
                  {t.isPublished && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-xs font-medium shrink-0">
                      <Check className="size-3" />
                      Published
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500">
                  Updated {new Date(t.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Link href={`/theme/${t.id}/builder`}>
                  <Button variant="secondary" size="sm">
                    Edit
                  </Button>
                </Link>
                <button
                  type="button"
                  onClick={() => void handleDelete(t.id)}
                  aria-label="Delete theme"
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </Card>
          ))
        )}

        <button
          type="button"
          onClick={() => void handleAddTheme()}
          disabled={creating}
          className="rounded-lg border-2 border-dashed border-black/15 dark:border-white/15 flex flex-col items-center justify-center gap-2 p-5 text-zinc-500 hover:border-black/30 dark:hover:border-white/30 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="size-6" />
          <span className="text-sm font-medium">{creating ? "Creating…" : "Add theme"}</span>
        </button>
      </div>
    </PageShell>
  );
}
