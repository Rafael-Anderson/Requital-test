import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Card from "@/components/ui/Card";

export interface ShopWideSummaryRow {
  label: string;
  value: string;
}

// Read-only stand-in, on an outlet's own page, for settings that were moved out
// to a shop-wide page (audit §14.4/§14.6). The values are shown so a merchant
// who went looking in the old place still sees the answer, and the link says
// plainly that editing it changes every outlet.
export default function ShopWideSummary({
  title,
  rows,
  links,
}: {
  title: string;
  rows: ShopWideSummaryRow[];
  links: { href: string; label: string }[];
}) {
  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-text-faint mb-4">
        These apply to every outlet, so they are no longer edited from a single outlet.
      </p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 border-b border-border dark:border-white/10 pb-1.5">
            <dt className="text-text-secondary dark:text-zinc-400">{row.label}</dt>
            <dd className="font-medium text-text-primary dark:text-zinc-100 text-end">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text dark:text-accent hover:underline"
          >
            {l.label}
            <ArrowRight className="size-3.5" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

// "Card online, Cash on Delivery" for the summary row; "None" when nothing is on.
export function paymentMethodsSummary(
  cardOnline: boolean,
  cash: boolean,
  cardOnFulfillment: boolean,
  cashLabel: string,
  cardLabel: string,
): string {
  const on = [cardOnline && "Card (online)", cash && cashLabel, cardOnFulfillment && cardLabel].filter(Boolean);
  return on.length ? on.join(", ") : "None";
}
