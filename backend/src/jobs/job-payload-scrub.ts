// A job whose payload carries a live secret (a driver's magic link, a customer's
// one-time delivery code) is enqueued with `sensitive: true`. The queue keeps the
// payload only until it is no longer needed: on completion and on dead-letter the
// message text is replaced (JobsService.completeJob / failJob), so the secret never
// sits in the never-pruned job table or in GET /jobs/failed.
export const SCRUBBED = '[scrubbed]';
const SENSITIVE_TEXT_KEYS = ['body', 'bodyText', 'html'];

export function isSensitivePayload(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { sensitive?: unknown }).sensitive === true
  );
}

export function isScrubbedPayload(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { scrubbed?: unknown }).scrubbed === true
  );
}

// Returns the payload unchanged unless it is sensitive.
export function scrubSensitivePayload<T>(payload: T): T {
  if (!isSensitivePayload(payload)) return payload;
  const out: Record<string, unknown> = {
    ...(payload as Record<string, unknown>),
    scrubbed: true,
  };
  for (const k of SENSITIVE_TEXT_KEYS) if (k in out) out[k] = SCRUBBED;
  return out as T;
}
