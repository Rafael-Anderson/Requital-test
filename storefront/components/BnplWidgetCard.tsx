"use client";

// The PDP "Buy Now Pay Later!" card, shown under the add-to-cart CTA row.
// Mounts each configured provider's own real, official on-site-messaging
// widget (TabbyPromoWidget / TamaraWidget) — the installment math and
// legal copy shown are entirely the provider's own, computed live from the
// real product price, not hand-written here. Only the card's own title and
// structural chrome (border, divider between rows) belong to us; no
// per-provider name label or "Learn More" link of our own — each widget
// already renders its own branding and its own official learn-more
// trigger, so a second one here would be redundant (and, for a link,
// point at a generic marketing page instead of the widget's own accurate
// payment-schedule popup).
//
// The caller only renders this when the theme's
// globalSettings.productPage.showBnplWidget toggle is on and the product
// isn't a gift card; a provider's row only shows when its public key is
// configured AND its widget script hasn't failed to load (never a broken/
// blank row — see onLoadError below).
import { useCallback, useState } from "react";
import TabbyPromoWidget from "./TabbyPromoWidget";
import TamaraWidget from "./TamaraWidget";

// TEMPORARY kill switch — the Tamara widget shipped (PR #129) verified only
// via doc-matching + a live-script identifier check (cdn.tamara.co/widget-v2/tamara-widget.js
// does contain tamaraWidgetConfig/tamara-widget/tamara-summary/publicKey),
// never an actual rendered confirmation — Tamara issues sandbox keys
// per-merchant by email/support, no shared public test key exists, so this
// couldn't be visually verified before merge. Forces the Tamara row to
// behave as if unconfigured, independent of tamaraPublicKey, until a real
// sandbox key is obtained and the widget is confirmed to actually render.
// Flip back to true once that happens — do not remove/rebuild this gate,
// the Tabby row and all Tamara code are untouched and intentionally still
// present underneath it.
const TAMARA_WIDGET_ENABLED = false;

export default function BnplWidgetCard({
  tabbyPublicKey,
  tabbyMerchantCode,
  tamaraPublicKey,
  price,
  currency,
}: {
  tabbyPublicKey: string | null;
  tabbyMerchantCode: string | null;
  tamaraPublicKey: string | null;
  price: string;
  currency: string;
}) {
  const [tabbyFailed, setTabbyFailed] = useState(false);
  const [tamaraFailed, setTamaraFailed] = useState(false);
  // Stable across re-renders so the widgets' own effects (which list this
  // callback in their deps) don't reload the external script on every
  // unrelated parent re-render — only on a genuine price/key change.
  const onTabbyError = useCallback(() => setTabbyFailed(true), []);
  const onTamaraError = useCallback(() => setTamaraFailed(true), []);

  const showTabby = !!tabbyPublicKey && !tabbyFailed;
  const showTamara = TAMARA_WIDGET_ENABLED && !!tamaraPublicKey && !tamaraFailed;
  if (!showTabby && !showTamara) return null;

  return (
    <div className="mt-4 theme-round-lg border border-stroke p-4">
      <p className="text-sm font-semibold text-product-name">Buy Now Pay Later!</p>
      <div className="mt-2 divide-y divide-stroke">
        {showTabby && (
          <div className="py-2.5 first:pt-0 last:pb-0">
            <TabbyPromoWidget
              publicKey={tabbyPublicKey!}
              merchantCode={tabbyMerchantCode ?? tabbyPublicKey!}
              price={price}
              currency={currency}
              onLoadError={onTabbyError}
            />
          </div>
        )}
        {showTamara && (
          <div className="py-2.5 first:pt-0 last:pb-0">
            <TamaraWidget publicKey={tamaraPublicKey!} price={price} onLoadError={onTamaraError} />
          </div>
        )}
      </div>
    </div>
  );
}
