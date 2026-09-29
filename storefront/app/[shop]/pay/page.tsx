"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getPaymentLinkSummary, startPaymentLinkCheckout } from "@/lib/api";
import { formatPriceAmount } from "@/lib/currency";
import type { PaymentLinkSummary } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import CurrencySymbol from "@/components/CurrencySymbol";
import {
  AUTH_CARD_CLASS,
  AUTH_HEADING_CLASS,
  BUTTON_PRIMARY_CLASS,
} from "@/lib/form-styles";

// The landing page for a merchant-sent payment link, and the gateway's cancel
// target. Lives under [shop] rather than at the app root because proxy.ts
// prepends the resolved shop slug to every non-local request, so a top-level
// /pay could never be reached on a real host — and because only here does the
// page sit inside ShopProvider, so it is themed like the rest of the storefront.
//
// Token arrives as ?token=, matching the three existing token pages
// ([shop]/survey, [shop]/orders/track, [shop]/cart/recover) rather than
// inventing a path segment.
function PayContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [summary, setSummary] = useState<PaymentLinkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A missing token is knowable at render time, so it is derived below rather
  // than set from the effect (which would be a cascading-render setState, and
  // there is nothing to load in that case anyway).
  const [loading, setLoading] = useState(Boolean(token));
  const [starting, setStarting] = useState(false);
  const shownError = token
    ? error
    : "This payment link is missing its token.";

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    // The SUMMARY endpoint, not GET /pay/:token — that one mints a gateway
    // checkout session and writes paymentSessionId, so calling it here would
    // create a live session on every render and every refresh.
    getPaymentLinkSummary(token)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Couldn't find that payment link",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handlePay() {
    setStarting(true);
    setError(null);
    try {
      const result = await startPaymentLinkCheckout(token);
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      // Paid between render and click — re-read rather than guess.
      setSummary(await getPaymentLinkSummary(token));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't start the payment",
      );
      setStarting(false);
    }
  }

  return (
    <StorefrontPageShell variant="narrow">
      <div className={AUTH_CARD_CLASS}>
        <h1 className={`${AUTH_HEADING_CLASS} mb-2`}>Complete your payment</h1>

        {loading && <p className="text-sm text-zinc-500">Loading…</p>}

        {!loading && shownError && (
          <p className="text-sm text-red-600">{shownError}</p>
        )}

        {!loading && summary && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">
              Order #{summary.shopOrderNumber}
              {summary.shopName ? ` from ${summary.shopName}` : ""}
            </p>
            <p className="text-2xl font-semibold">
              {formatPriceAmount(summary.total, summary.currency)}{" "}
              <CurrencySymbol code={summary.currency} />
            </p>

            {summary.alreadyPaid && (
              <p className="text-sm text-green-700">
                This order has already been paid. Nothing further is owed.
              </p>
            )}

            {!summary.alreadyPaid && summary.expired && (
              <p className="text-sm text-red-600">
                This payment link has expired. Ask the shop to send you a new
                one.
              </p>
            )}

            {!summary.alreadyPaid && !summary.expired && (
              <button
                type="button"
                onClick={() => void handlePay()}
                disabled={starting}
                className={BUTTON_PRIMARY_CLASS}
              >
                {starting ? "Redirecting…" : "Pay now"}
              </button>
            )}
          </div>
        )}
      </div>
    </StorefrontPageShell>
  );
}

export default function PayPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <PayContent />
    </Suspense>
  );
}
