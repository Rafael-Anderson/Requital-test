"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { getPaymentLinkSummary } from "@/lib/api";
import { formatPriceAmount } from "@/lib/currency";
import type { PaymentLinkSummary } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import CurrencySymbol from "@/components/CurrencySymbol";
import { AUTH_CARD_CLASS, AUTH_HEADING_CLASS } from "@/lib/form-styles";

// The gateway's success target for a payment link. Read-only by design: the
// order is marked paid by the WEBHOOK, not by the customer arriving here (a
// return URL is a navigation, not proof of payment — see PaymentsService's
// webhook handling and the reconciliation sweep). So this page reports what the
// server currently believes and never writes anything.
function PaySuccessContent() {
  const searchParams = useSearchParams();
  const { shopBasePath } = useShop();
  const token = searchParams.get("token") ?? "";

  const [summary, setSummary] = useState<PaymentLinkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Derived, not set from the effect — see the sibling /pay page.
  const [loading, setLoading] = useState(Boolean(token));
  const [retryKey, setRetryKey] = useState(0);
  const shownError = token ? error : "This link is missing its token.";

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPaymentLinkSummary(token)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Couldn't load that order",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, retryKey]);

  function retry() {
    setError(null);
    setLoading(true);
    setRetryKey((k) => k + 1);
  }

  return (
    <StorefrontPageShell variant="narrow">
      <div className={AUTH_CARD_CLASS}>
        <h1 className={`${AUTH_HEADING_CLASS} mb-2`}>Thank you</h1>

        {loading && <p className="text-sm text-zinc-500">Loading…</p>}
        {!loading && shownError && (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-red-600">{shownError}</p>
            {token && !summary && (
              <button type="button" onClick={retry} className="text-sm font-medium text-accent-text hover:underline cursor-pointer">
                Try again
              </button>
            )}
          </div>
        )}

        {!loading && summary && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">
              Order #{summary.shopOrderNumber}
              {summary.shopName ? ` from ${summary.shopName}` : ""}
            </p>
            <p className="text-2xl font-semibold">
              {formatPriceAmount(summary.total, summary.currency)}{" "}
              <CurrencySymbol code={summary.currency} />
            </p>
            {summary.alreadyPaid ? (
              <p className="text-sm text-green-700">
                Payment received. The shop has been notified.
              </p>
            ) : (
              // Not an error: gateways redirect before their webhook lands, so
              // "not yet confirmed" is the normal first state here.
              <p className="text-sm text-zinc-500">
                Your payment is being confirmed. This can take a moment. The
                shop will see it as soon as it clears.
              </p>
            )}
          </div>
        )}

        {!loading && (
          <Link href={shopBasePath || "/"} className="mt-6 inline-block text-sm font-medium text-accent-text hover:underline">
            Continue shopping
          </Link>
        )}
      </div>
    </StorefrontPageShell>
  );
}

export default function PaySuccessPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <PaySuccessContent />
    </Suspense>
  );
}
