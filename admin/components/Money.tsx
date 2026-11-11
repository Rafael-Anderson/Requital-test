import { formatAmount, formatMoney } from "@/lib/money";
import CurrencySymbol from "@/components/CurrencySymbol";

// A money amount for JSX: "199.00" followed by the Dirham symbol for AED, or the exact text
// formatMoney() gives ("1,234.500 KWD") for every other currency. The amount is formatted by
// the same lib/money.ts helpers every text context uses (minor-unit aware, never toFixed), so
// the symbol is the only difference between this and formatMoney(). Use formatMoney() where a
// string is required (CSV, attributes, template strings, <option> text).
export default function Money({
  amount,
  currency,
  className,
}: {
  amount: number | string | null | undefined;
  currency: string | null | undefined;
  className?: string;
}) {
  const code = (currency ?? "").trim().toUpperCase();
  if (code !== "AED") return <>{formatMoney(amount, currency)}</>;
  const text = formatAmount(amount, code);
  return (
    <>
      {text ? `${text} ` : ""}
      <CurrencySymbol code={code} className={className} />
    </>
  );
}
