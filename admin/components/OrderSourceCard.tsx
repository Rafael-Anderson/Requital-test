import type { AttributionTouchView, OrderAttributionView } from "@/lib/types";

function touchLine(t: AttributionTouchView | null): string | null {
  if (!t) return null;
  const parts = [t.source, t.medium, t.campaign].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : null;
}

const CONSENT_LABEL = (v: boolean | null) =>
  v === true ? "Accepted" : v === false ? "Declined" : "Not recorded";

// Where the order came from (MKT-14). `attribution` null/undefined means the source
// was never recorded for this order, which is shown as exactly that: it is not the
// same claim as "direct", and must never be rendered as one.
export default function OrderSourceCard({ attribution }: { attribution: OrderAttributionView | null | undefined }) {
  const last = touchLine(attribution?.lastTouch ?? null);
  const first = touchLine(attribution?.firstTouch ?? null);
  const showFirst = first !== null && first !== last;
  const landing = attribution?.lastTouch?.landingPath ?? attribution?.firstTouch?.landingPath;
  const referrer = attribution?.lastTouch?.referrer ?? attribution?.firstTouch?.referrer;

  return (
    <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10">
      <h3 className="font-medium mb-2">Source</h3>
      {!attribution || (!last && !first) ? (
        <p className="text-sm text-text-muted">
          Not recorded. This order was placed before source tracking, entered by staff, or the
          shopper&apos;s browser sent nothing.
        </p>
      ) : (
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-text-faint">Last touch</dt>
            <dd className="font-medium text-end break-words">{last ?? "Not recorded"}</dd>
          </div>
          {showFirst && (
            <div className="flex justify-between gap-3">
              <dt className="text-text-faint">First touch</dt>
              <dd className="text-end break-words">{first}</dd>
            </div>
          )}
          {landing && (
            <div className="flex justify-between gap-3">
              <dt className="text-text-faint">Landing page</dt>
              <dd className="text-end break-all">{landing}</dd>
            </div>
          )}
          {referrer && (
            <div className="flex justify-between gap-3">
              <dt className="text-text-faint">Referrer</dt>
              <dd className="text-end break-all">{referrer}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-text-faint">Marketing cookies</dt>
            <dd className="text-end">{CONSENT_LABEL(attribution.consentMarketing)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
