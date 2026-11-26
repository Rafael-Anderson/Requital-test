"use client";

import type { MetaErrorDetails, WhatsAppConnectionTest } from "@/lib/types";
import { displayNumberMatches } from "@/lib/whatsapp-credentials";

// The outcome of a WhatsApp Test connection (or a failed test message): a
// friendly sentence, and for a Meta failure a "Details" expander with Meta's own
// message and the fbtrace_id (what Meta support asks for). Never a token.
export function MetaErrorDetailsBlock({ details }: { details: MetaErrorDetails | null | undefined }) {
  if (!details || (!details.metaMessage && !details.fbtraceId)) return null;
  return (
    <details className="mt-1 text-xs text-text-muted">
      <summary className="cursor-pointer select-none">Details</summary>
      <dl className="mt-1 space-y-0.5">
        {details.metaMessage && (
          <div>
            <dt className="inline font-medium">Meta says: </dt>
            <dd className="inline break-words">{details.metaMessage}</dd>
          </div>
        )}
        {details.fbtraceId && (
          <div>
            <dt className="inline font-medium">fbtrace_id: </dt>
            <dd className="inline font-mono break-all">{details.fbtraceId}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}

export default function WhatsAppConnectionResult({
  result,
  countryCode,
  localNumber,
}: {
  result: WhatsAppConnectionTest;
  countryCode: string;
  localNumber: string;
}) {
  if (!result.ok) {
    return (
      <div role="alert" data-testid="whatsapp-connection-failed" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        <p>{result.message}</p>
        <MetaErrorDetailsBlock details={result.details} />
      </div>
    );
  }
  const matches = displayNumberMatches(result.displayPhoneNumber, countryCode, localNumber);
  return (
    <div role="status" data-testid="whatsapp-connection-ok" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300">
      <p>
        Connected to Meta.
        {result.displayPhoneNumber && <> Number: <span className="font-medium">{result.displayPhoneNumber}</span>.</>}
        {result.verifiedName && <> Name: <span className="font-medium">{result.verifiedName}</span>.</>}
      </p>
      {matches === false && (
        <p data-testid="whatsapp-number-mismatch" className="mt-1 text-amber-700 dark:text-amber-300">
          This is not the WhatsApp Number set above. Check that you copied the Phone Number ID of the right number.
        </p>
      )}
    </div>
  );
}
