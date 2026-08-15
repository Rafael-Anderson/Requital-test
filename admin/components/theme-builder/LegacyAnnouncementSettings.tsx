"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import TagInput from "@/components/ui/TagInput";
import { useLegacyTheme } from "@/lib/useLegacyTheme";

// The old Theme Customizer's "Site Header Notification Text" + announcement
// toggles (app/theme/edit/site-settings/page.tsx) — a genuinely separate
// mechanism from this section's own repeatable announcement blocks above
// (see CLAUDE.md: components/AnnouncementBar.tsx stays global chrome,
// governed by shop.announcementBarEnabled, untouched by the new builder).
// Kept here since it's the same concept in spirit — placed in the
// Announcement Bar section for discoverability, even though it drives a
// different, always-on banner than this section's own blocks.
export default function LegacyAnnouncementSettings() {
  const { theme, saving, save } = useLegacyTheme();
  const [notificationText, setNotificationText] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    if (!theme) return;
    setNotificationText(theme.notificationText ?? []);
    setEnabled(theme.announcementBarEnabled);
    setScrolling(theme.announcementBarScrolling);
  }, [theme]);

  if (!theme) return null;

  async function handleSave() {
    await save({ notificationText, announcementBarEnabled: enabled, announcementBarScrolling: scrolling });
  }

  return (
    <details className="rounded-lg border border-black/10 dark:border-white/10">
      <summary className="cursor-pointer p-3 text-sm font-medium">Classic announcement bar</summary>
      <div className="space-y-4 border-t border-black/10 p-3 dark:border-white/10">
        <p className="text-xs text-zinc-500">
          A separate, always-on banner shown above the header on the classic storefront look, independent of this
          section&apos;s own blocks above.
        </p>
        <div>
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Notification text</label>
          <TagInput tags={notificationText} onChange={setNotificationText} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <Toggle checked={enabled} onChange={setEnabled} />
            <span className="text-sm">Show announcement bar</span>
          </div>
          <div className="flex items-center gap-2">
            <Toggle checked={scrolling} onChange={setScrolling} />
            <span className="text-sm">Scroll continuously (marquee)</span>
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave()}>
            Save
          </Button>
        </div>
      </div>
    </details>
  );
}
