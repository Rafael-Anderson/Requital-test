import { currencySymbol } from "@/lib/currency";
import { DIRHAM_SYMBOL_PATH, DIRHAM_SYMBOL_VIEWBOX_WIDTH } from "@/lib/dirham-symbol";

// The ONE place the UAE Dirham symbol is drawn. An inline SVG (traced from the official
// symbol: a bold D whose stem is crossed by two horizontal bars) because no installed
// font reliably has the glyph. currentColor, sized in em so it follows the surrounding
// text, bottom on the text baseline (the symbol is cap-height, like the digits beside
// it). Plain-text channels that cannot show an SVG (emails, PDFs, WhatsApp, JSON-LD,
// CSV, aria text) keep the ISO code "AED"; see lib/currency.ts.
//
// `size` scales the whole glyph relative to the surrounding font size (default 1em).
export function DirhamSymbol({ className, size = "1em" }: { className?: string; size?: string }) {
  const ratio = DIRHAM_SYMBOL_VIEWBOX_WIDTH / 1000;
  return (
    <svg
      role="img"
      aria-label="AED"
      data-currency-symbol="AED"
      viewBox={`0 0 ${DIRHAM_SYMBOL_VIEWBOX_WIDTH} 1000`}
      className={className}
      style={{
        display: "inline-block",
        height: `calc(${size} * 0.72)`,
        width: `calc(${size} * ${(0.72 * ratio).toFixed(4)})`,
        verticalAlign: "baseline",
        overflow: "visible",
      }}
      fill="currentColor"
      fillRule="evenodd"
      focusable="false"
    >
      <path d={DIRHAM_SYMBOL_PATH} />
    </svg>
  );
}

// `size` defaults to 1em (unchanged everywhere that doesn't pass it).
export default function CurrencySymbol({ code, className, size }: { code: string | null | undefined; className?: string; size?: string }) {
  if (code === "AED") return <DirhamSymbol className={className} size={size} />;
  return <>{currencySymbol(code)}</>;
}
