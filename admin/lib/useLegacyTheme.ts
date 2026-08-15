"use client";

import { useCallback, useEffect, useState } from "react";
import { getTheme, updateTheme } from "@/lib/api";
import type { ThemeSettings } from "@/lib/types";

// Shared by every "classic theme settings" block folded into the new
// builder (Layout mode's categories, Header/Footer/Announcement Bar/Hero's
// legacy sub-sections, Colors' legacy color block) — the legacy
// `themesettings` row is a genuinely separate data model from the new
// builder's theme.config (see CLAUDE.md's "two systems, deliberately not
// merged" note), so every one of these blocks reads/writes it directly via
// the same GET/PATCH /theme this hook wraps, independently of `useThemeEditor`'s
// own config/autosave. PATCH /theme is a real partial update server-side
// (ThemeService.upsert only touches keys actually sent), so many independent
// callers each saving their own field subset is safe — no clobbering.
export function useLegacyTheme() {
  const [theme, setTheme] = useState<ThemeSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getTheme()
      .then(setTheme)
      .catch(() => {});
  }, []);

  const save = useCallback(async (patch: Partial<Omit<ThemeSettings, "shopId" | "updatedAt">>) => {
    setSaving(true);
    try {
      const updated = await updateTheme(patch);
      setTheme(updated);
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { theme, saving, save };
}
