import type { AnnouncementBarConfig } from "@/lib/types";

// The legacy notification bar's fields (themesettings), as the builder sees them.
export interface LegacyAnnouncement {
  announcementBarEnabled?: boolean;
  announcementBarScrolling?: boolean;
  notificationText?: string[] | null;
}

/**
 * What to store at header.settings.announcementBar when the builder first opens, so the single
 * Sections-tab "Announcement bar" shows (and keeps showing) whatever the shop already had.
 * Returns null when nothing needs to change.
 *
 *  - already `managed`: nothing to do.
 *  - no stored config: adopt an enabled legacy bar; otherwise leave it absent.
 *  - stored but disabled and empty while the legacy bar is on: the legacy bar is what visitors see
 *    today, so adopt it (enabled), keeping any other stored settings.
 *  - any other stored config: adopt as it stands (just mark it managed).
 */
export function adoptLegacyAnnouncement(
  stored: AnnouncementBarConfig | undefined,
  legacy: LegacyAnnouncement,
): AnnouncementBarConfig | null {
  if (stored && stored.managed === true) return null;
  const legacyMessages = (legacy.notificationText ?? []).filter((m) => typeof m === "string" && m.trim());
  const legacyOn = !!legacy.announcementBarEnabled && legacyMessages.length > 0;
  const storedHasMessages = !!stored && Array.isArray(stored.messages) && stored.messages.some((m) => m && m.trim());
  if (!stored) {
    return legacyOn
      ? { enabled: true, managed: true, messages: legacyMessages, scrolling: !!legacy.announcementBarScrolling }
      : null;
  }
  if (!stored.enabled && !storedHasMessages && legacyOn) {
    return { ...stored, enabled: true, managed: true, messages: legacyMessages, scrolling: !!legacy.announcementBarScrolling };
  }
  return { ...stored, managed: true };
}
