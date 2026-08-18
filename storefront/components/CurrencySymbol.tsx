import { currencySymbol } from "@/lib/currency";

// Bug 7 fix: the previous "د.إ" was Arabic script text for "dirham," not
// the UAE Central Bank's actual new Dirham currency symbol (a distinct
// glyph, not yet a real Unicode codepoint any browser/OS font could be
// relied on to render consistently — the same reasoning the ticket itself
// gives for using an SVG instead of a text character here). Rendered as an
// inline SVG so it displays identically everywhere regardless of installed
// fonts, sized to the surrounding text via `1em` + `currentColor` so it
// drops into the exact spots `currencySymbol()` used to fill as plain
// text.
//
// FLAGGED, not fully verified: this path is a best-effort reproduction
// built from the publicly described design (a "D"-like stroke crossed by
// two horizontal bars) - there was no reference asset available in this
// session to trace against pixel-for-pixel. Treat this as a placeholder
// that should be swapped for the real official SVG/icon export the first
// chance there is to compare against it directly.
function AedGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      width="0.75em"
      height="0.75em"
      style={{ display: "inline-block", verticalAlign: "-0.05em" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4 L6 20" />
      <path d="M6 4 C 11 4, 14 7.5, 14 12 C 14 16.5, 11 20, 6 20" />
      <path d="M3 9 L13 9" />
      <path d="M3 15 L13 15" />
    </svg>
  );
}

export default function CurrencySymbol({ code, className }: { code: string | null | undefined; className?: string }) {
  if (code === "AED") return <AedGlyph className={className} />;
  return <>{currencySymbol(code)}</>;
}
