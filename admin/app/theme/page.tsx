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

// Two data models, deliberately not merged (see CLAUDE.md's "two systems"
// note), but ONE editor now: "Edit theme" on the Current theme card used to
// open the old /theme/edit/* tabs directly — it now opens the same builder
// every custom theme uses instead, which folds every one of those tabs'
// fields in as "classic ..." sub-sections (Layout mode, and collapsible
// blocks inside Header/Footer/Announcement Bar/Hero/Colors) so nothing on
// the old pages became unreachable. "Custom themes" is the new
// section-based visual builder — a real library (create/publish/delete),
// available to every shop immediately, not gated behind any flag.
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

  // The published custom theme is what's actually live for shoppers right
  // now, so that's what "Edit theme" opens — falling back to the most
  // recently updated one if nothing's published yet, and creating a first
  // theme (same as "Add theme") if this shop has none at all, rather than
  // ever falling back to the old /theme/edit/* pages.
  async function handleEditCurrentTheme() {
    if (themes && themes.length > 0) {
      const target = themes.find((t) => t.isPublished) ?? themes[0];
      router.push(`/theme/${target.id}/builder`);
      return;
    }
    await handleAddTheme();
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
    <PageShell variant="wide">
      <BackButton href="/" />
      <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-1.5">Theme</h1>
      <p className="text-[13.5px] text-text-faint mb-6">Your storefront's current look, content, and layout.</p>

      {!theme ? (
        <CardSkeleton />
      ) : (
        <Card className="flex flex-col sm:flex-row items-start sm:items-center gap-[18px] mb-8">
          <div
            className="size-16 rounded-xl shrink-0 flex items-center justify-center overflow-hidden bg-accent-tint dark:bg-accent/15"
          >
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="max-w-full max-h-full object-contain p-2" />
            ) : (
              <Palette className="size-[26px] text-accent" style={{ color: brandColor }} />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-base font-bold text-text-primary dark:text-zinc-50">Current theme</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-tint text-accent-text dark:bg-accent/15 dark:text-accent px-2.5 py-0.5 text-[11px] font-bold">
                <Check className="size-2.5" strokeWidth={3} />
                Active
              </span>
            </div>
            <p className="text-[13.5px] text-text-muted">
              {layoutOption?.label ?? "Classic"} layout
              {theme.updatedAt && ` · last saved ${new Date(theme.updatedAt).toLocaleString()}`}
            </p>
          </div>

          <Button variant="primary" className="shrink-0" loading={creating} onClick={() => void handleEditCurrentTheme()}>
            Edit theme
          </Button>
        </Card>
      )}

      <h2 className="text-[17px] font-extrabold text-text-primary dark:text-zinc-50 mb-1.5">Custom themes</h2>
      <p className="text-[13.5px] text-text-faint mb-[18px]">
        Build a section-based homepage with the visual editor. Publishing a custom theme takes over your
        homepage, header, and footer.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {themes === null ? (
          <CardSkeleton />
        ) : (
          themes.map((t) => (
            <Card key={t.id} className="flex items-center gap-3.5 p-[18px]">
              <div className="size-11 rounded-[10px] shrink-0 flex items-center justify-center bg-accent-tint dark:bg-accent/15">
                <Palette className="size-[19px] text-accent-text dark:text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-[14.5px] font-bold text-text-primary dark:text-zinc-50 truncate">{t.name}</h3>
                  {t.isPublished && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent-tint text-accent-text dark:bg-accent/15 dark:text-accent px-2 py-0.5 text-[10.5px] font-bold shrink-0">
                      Published
                    </span>
                  )}
                </div>
                <p className="text-[12.5px] text-text-faint mt-0.5">
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
                  className="p-1.5 rounded-lg text-text-faint hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
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
          className="rounded-2xl border-[1.5px] border-dashed border-[#D3D8D7] dark:border-white/15 flex flex-col items-center justify-center gap-2 p-[18px] min-h-20 text-text-muted hover:border-accent-mid hover:text-accent-text hover:bg-[#FAFCFC] dark:hover:border-white/30 dark:hover:text-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="size-5" />
          <span className="text-[13.5px] font-semibold">{creating ? "Creating…" : "Add theme"}</span>
        </button>
      </div>
    </PageShell>
  );
}
