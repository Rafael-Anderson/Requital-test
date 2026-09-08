// The PDP "Buy Now Pay Later!" card, shown under the add-to-cart CTA row.
// One static row per available provider, separated by a thin divider.
//
// This used to embed each provider's own official on-site-messaging SDK
// (tabby-promo.js / tamara-widget.js), which computed the instalment
// breakdown itself. Those are gone: the copy below is now OURS, fixed text,
// not provider-computed — see storefront/CLAUDE.md's compliance note. The
// upside is the card renders with no provider key present and no external
// script load; the row still only shows for a provider that's actually
// enabled + configured (the caller passes `tabby`/`tamara` off the same
// key-presence check as before).
//
// The caller only renders this when at least one provider is available AND
// the theme's globalSettings.productPage.showBnplWidget toggle is on.

const ROWS = [
  {
    key: "tabby" as const,
    name: "tabby",
    href: "https://tabby.ai/en-AE",
    copy: "Pay in 4 interest-free payments!",
  },
  {
    key: "tamara" as const,
    name: "tamara",
    href: "https://tamara.co/en-AE",
    copy: "Split your bill into 3 payments. Interest-free!",
  },
];

export default function BnplWidgetCard({ tabby, tamara }: { tabby: boolean; tamara: boolean }) {
  const rows = ROWS.filter((r) => (r.key === "tabby" ? tabby : tamara));
  if (rows.length === 0) return null;

  return (
    <div className="mt-4 theme-round-lg border border-stroke p-4">
      <p className="text-sm font-semibold text-product-name">Buy Now Pay Later!</p>
      <div className="mt-2 divide-y divide-stroke">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            {/* No provider logo assets exist in this app (payment-badges.ts
                renders text labels + generic icons the same way) — a styled
                wordmark stays consistent with that. */}
            <span className="w-16 shrink-0 text-sm font-semibold lowercase text-product-name">{r.name}</span>
            <span className="flex-1 text-sm text-price-main">{r.copy}</span>
            <a
              href={r.href}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-sm font-medium text-accent-text hover:underline"
            >
              Learn More
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
