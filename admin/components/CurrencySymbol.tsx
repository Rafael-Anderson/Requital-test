import { DIRHAM_SYMBOL_PATH, DIRHAM_SYMBOL_VIEWBOX_WIDTH } from "@/lib/dirham-symbol";

// The ONE place admin draws the UAE Dirham symbol (an inline SVG traced from the official
// symbol; lib/dirham-symbol.ts has the shape, identical to the storefront's). currentColor,
// sized in em to follow the surrounding text, bottom on the baseline. Plain-text channels
// (CSV, exports, emails, PDFs, aria text, <option> labels, inputs' placeholder) keep the ISO
// code "AED" via lib/money.ts formatMoney().
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

// The currency of a price: the Dirham symbol for AED, the ISO code for everything else
// (no other currency has a symbol component yet, and "1,234.500 KWD" is unambiguous).
export default function CurrencySymbol({ code, className, size }: { code: string | null | undefined; className?: string; size?: string }) {
  const c = (code ?? "").trim().toUpperCase();
  if (c === "AED") return <DirhamSymbol className={className} size={size} />;
  return <>{c}</>;
}
