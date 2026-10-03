// Pure helpers for what a shopper-facing review is allowed to show. Kept apart
// from the service so the privacy rule (first name plus last initial, plain
// bounded text, nothing else) is one small file with a spec.

export const REVIEW_COMMENT_MAX_CHARS = 600;
const FIRST_NAME_MAX_CHARS = 30;

// "Reem Al Mansoori" -> "Reem M.", "Reem" -> "Reem". Code points, not UTF-16
// units, so an Arabic or emoji-led initial is never split in half. A name that
// is empty after trimming returns "Customer".
export function publicReviewerName(
  fullName: string | null | undefined,
): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Customer';
  const first = Array.from(parts[0]).slice(0, FIRST_NAME_MAX_CHARS).join('');
  if (parts.length === 1) return first;
  const initial = Array.from(parts[parts.length - 1])[0];
  return `${first} ${initial}.`;
}

// Plain text only: the storefront renders it as a text node and the API never
// returns markup semantics. Control characters are dropped (newlines and tabs
// kept), and the text is capped on code points with an ellipsis.
export function publicReviewComment(
  comment: string | null | undefined,
): string {
  const clean = Array.from(comment ?? '')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127);
    })
    .join('')
    .trim();
  const chars = Array.from(clean);
  if (chars.length <= REVIEW_COMMENT_MAX_CHARS) return clean;
  return `${chars.slice(0, REVIEW_COMMENT_MAX_CHARS).join('').trimEnd()}…`;
}
