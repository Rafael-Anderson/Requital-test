import { currencySymbol } from "@/lib/currency";

// Bug 7 fix: the previous "د.إ" was Arabic script text for "dirham," not
// the UAE Central Bank's actual new Dirham currency symbol (a distinct
// glyph, not yet a real Unicode codepoint any browser/OS font could be
// relied on to render consistently — the same reasoning the ticket itself
// gives for using an SVG instead of a text character here). Rendered as an
// inline SVG so it displays identically everywhere regardless of installed
// fonts, sized to the surrounding text via `1em` + `currentColor` so it
// drops into the exact spots `currencySymbol()` used to fill as plain text.
//
// FLAGGED, not fully verified: this path is a best-effort reproduction of
// the publicly described design (a rounded "D" whose vertical stem is
// crossed by two horizontal bars) — no reference asset was available to
// trace pixel-for-pixel. Swap for the real official SVG export when one is
// available. Default size is 1em (was 0.75em, which read visibly smaller
// than adjacent numerals); stroke weight is tuned to sit with regular text.
function AedGlyph({ className, size = "1em" }: { className?: string; size?: string }) {
  return (
    <svg
      viewBox="0 0 20 24"
      className={className}
      width={size}
      height={size}
      style={{ display: "inline-block", verticalAlign: "-0.11em" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* vertical stem, extending slightly past the bowl top and bottom */}
      <path d="M5 2.5 V21.5" />
      {/* bowl of the D */}
      <path d="M5 3 C 12 3, 16.5 6.8, 16.5 12 C 16.5 17.2, 12 21, 5 21" />
      {/* two bars crossing the stem */}
      <path d="M1.75 9 H10" />
      <path d="M1.75 15 H10" />
    </svg>
  );
}

// `size` defaults to 1em (unchanged everywhere that doesn't pass it). Call
// sites no longer need to pass an explicit "1em" — that's now the default.
export default function CurrencySymbol({ code, className, size }: { code: string | null | undefined; className?: string; size?: string }) {
  if (code === "AED") return <AedGlyph className={className} size={size} />;
  return <>{currencySymbol(code)}</>;
}
