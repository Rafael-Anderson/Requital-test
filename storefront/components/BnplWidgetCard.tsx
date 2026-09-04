"use client";

import TabbyPromoWidget from "@/components/TabbyPromoWidget";
import TamaraWidget from "@/components/TamaraWidget";

// The PDP "Buy Now Pay Later!" card, shown under the price. One row per
// available provider, separated by a thin divider. Each row is that
// provider's own official on-site-messaging widget (tabby-promo.js /
// tamara-widget.js) — those render their own logo + "Pay in 4 / 3 payments"
// copy + info link, which is exactly the row layout asked for, so we embed
// the real SDK widget rather than hand-building a logo/copy/link row.
//
// The caller only renders this when at least one key is present AND the
// theme's globalSettings.productPage.showBnplWidget toggle is on.
export default function BnplWidgetCard({
  price,
  currency,
  tabbyKey,
  tamaraKey,
}: {
  price: number;
  currency: string;
  tabbyKey: string | null;
  tamaraKey: string | null;
}) {
  return (
    <div className="mt-4 theme-round-lg border border-stroke p-4">
      <p className="text-sm font-semibold text-product-name">Buy Now Pay Later!</p>
      <div className="mt-2 divide-y divide-stroke">
        {tabbyKey && (
          <div className="py-2.5 first:pt-0 last:pb-0">
            <TabbyPromoWidget price={price} currency={currency} publicKey={tabbyKey} />
          </div>
        )}
        {tamaraKey && (
          <div className="py-2.5 first:pt-0 last:pb-0">
            <TamaraWidget price={price} publicKey={tamaraKey} />
          </div>
        )}
      </div>
    </div>
  );
}
