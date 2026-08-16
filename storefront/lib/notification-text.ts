// themesettings.notificationText was a LONGTEXT column for a long time (see
// backend/prisma/migrations/20260816130000_fix_notification_text_column) —
// the app always wrote a JSON.stringify()'d array into it but LONGTEXT has
// no JSON semantics, so nothing ever parsed it back on read, and every
// consumer got the raw JSON-encoded string instead of an array (the same
// bug class this codebase's job.payload has already hit once before).
// Every consumer of this field goes through this instead of trusting the
// declared `string[] | null` type, so a pre-migration row, or any future
// regression that re-introduces the same shape mismatch, can't crash
// rendering again.
export function parseNotificationMessages(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return (Array.isArray(parsed) ? parsed : [raw]) as string[];
    } catch {
      return [raw];
    }
  }
  return [];
}
