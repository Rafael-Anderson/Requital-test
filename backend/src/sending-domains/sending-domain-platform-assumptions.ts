// EVERY provider wire detail for per-shop sending domains lives in this one
// file, and EVERY value in it is an UNVERIFIED ASSUMPTION written from memory
// of Resend's public documentation. No request has ever been made to Resend's
// domains API from this codebase (tests use the fake in
// resend-domains.client.fake.ts). Before a merchant relies on this the owner
// must check each line against Resend's current docs and a real throwaway
// domain. Nothing in the client hardcodes a URL, field name or status string:
// it reads it from here, so a correction is a one-file edit.

export const RESEND_DOMAINS_ASSUMPTIONS = {
  // UNVERIFIED: base URL of the domains resource (POST create, GET :id,
  // POST :id/verify, DELETE :id).
  baseUrl: 'https://api.resend.com/domains',
  // UNVERIFIED: Resend may require a FULL-ACCESS API key to manage domains; a
  // "sending access" key (like RESEND_API_KEY) may be refused. That is why a
  // separate optional RESEND_DOMAINS_API_KEY exists. Which scope is needed, and
  // whether one key can do both, is unknown.
  keyEnv: 'RESEND_DOMAINS_API_KEY',
  // UNVERIFIED: the create body is { name: <domain> }.
  createBodyField: 'name',
  // UNVERIFIED: the create/get response carries `id`, `status`, `records[]`.
  // Each record: { record: 'SPF'|'DKIM'|'MX'|..., name, type, value, ttl,
  // priority?, status }. We store only { type, name, value, priority } plus the
  // provider's own label, and render them as given.
  // UNVERIFIED: the provider's domain status vocabulary. We map anything that
  // is not exactly 'verified' or 'failed' to "still waiting" (see mapStatus).
  verifiedStatus: 'verified',
  failedStatuses: ['failed', 'temporary_failure'],
  // UNVERIFIED: Resend limits how many domains an account may hold (plan
  // dependent) and rate-limits the API (about 2 requests per second is
  // remembered). The 429/limit failure is surfaced to the merchant as a generic
  // "try again later", never retried in a loop.
  // UNVERIFIED: deliverability. A freshly verified domain has no sending
  // reputation; mail may land in spam until it warms up. SPF, DKIM and DMARC
  // alignment is the provider's job; we do not check DMARC.
} as const;

// The fixed local part. A merchant cannot choose it: a free local part would
// let a shop send as ceo@, support@, etc. from a domain it proved only for DNS.
export const SENDING_LOCAL_PART = 'noreply';

export type ProviderDomainStatus = 'pending' | 'verified' | 'failed';

export function mapProviderStatus(
  raw: string | undefined,
): ProviderDomainStatus {
  if (raw === RESEND_DOMAINS_ASSUMPTIONS.verifiedStatus) return 'verified';
  if (
    raw !== undefined &&
    (RESEND_DOMAINS_ASSUMPTIONS.failedStatuses as readonly string[]).includes(
      raw,
    )
  ) {
    return 'failed';
  }
  return 'pending';
}
