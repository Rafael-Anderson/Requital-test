import { createLogger } from '../../common/logging/logger';
import type { NomodAmounts } from './nomod-money';

const logger = createLogger('NomodClient');

export const NOMOD_DEFAULT_BASE_URL = 'https://api.nomod.com';
// Hosts a base URL may point at. The documentation shows api.nomod.com and one
// example on api.nomod.dev; nothing else is ever called, whatever a merchant saves.
// Extra hosts can only come from the platform's own environment, never from a shop.
const BUILTIN_ALLOWED_HOSTS = ['api.nomod.com', 'api.nomod.dev'];

export const NOMOD_REQUEST_TIMEOUT_MS = 15_000;
const GET_ATTEMPTS = 3;

function allowedHosts(): string[] {
  const extra = (process.env.NOMOD_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...BUILTIN_ALLOWED_HOSTS, ...extra];
}

export class NomodConfigError extends Error {}

// The ONLY place a base URL becomes a URL we will call: https, no userinfo, no
// port, no path/query, and the host on the allow-list. An override that fails any
// of this is an error, never silently replaced by the default.
export function resolveNomodBase(override?: string | null): string {
  const raw =
    override?.trim() ||
    process.env.NOMOD_API_BASE_URL?.trim() ||
    '' ||
    NOMOD_DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NomodConfigError('The Nomod base URL is not a valid URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new NomodConfigError(
      'The Nomod base URL must be a plain https origin',
    );
  }
  if (!allowedHosts().includes(url.hostname.toLowerCase())) {
    throw new NomodConfigError('That Nomod host is not allowed');
  }
  return `https://${url.hostname.toLowerCase()}`;
}

// A failure talking to Nomod. The message is safe to log and to show an admin:
// it carries the HTTP status and a fixed description, never the response body
// (which may echo customer data) and never a credential.
export class NomodApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    // true when the request may or may not have taken effect (timeout, network
    // error, 5xx): a caller must not assume it did NOT happen.
    readonly ambiguous: boolean,
  ) {
    super(message);
  }
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,100}$/;
function safeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new NomodApiError('invalid id', null, false);
  return encodeURIComponent(id);
}

export interface NomodCredentials {
  apiKey: string;
  baseUrl?: string | null;
}

export interface NomodCheckoutResponse {
  id: string;
  url: string | null;
  status: string | null;
  // As Nomod returns them: strings, or numbers, or absent. Callers that need a
  // figure parse it exactly (nomod-events.exactMinor); the response amount is
  // never trusted over our own stored amount.
  amount: unknown;
  currency: string | null;
  referenceId: string | null;
}

export interface NomodRefundResponse {
  refundId: string;
  status: string | null;
}

type FetchLike = typeof fetch;

export class NomodClient {
  constructor(
    private readonly fetchImpl: FetchLike = (
      input: string | URL | Request,
      init?: RequestInit,
    ) => fetch(input, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async createCheckout(
    creds: NomodCredentials,
    input: {
      referenceId: string;
      amounts: NomodAmounts;
      customer?: Record<string, string>;
      successUrl: string;
      failureUrl: string;
      cancelledUrl: string;
      metadata?: Record<string, string>;
    },
    signal?: AbortSignal,
  ): Promise<NomodCheckoutResponse & { url: string }> {
    const body: Record<string, unknown> = {
      reference_id: input.referenceId,
      amount: input.amounts.amount,
      currency: input.amounts.currency,
      items: input.amounts.items,
      success_url: input.successUrl,
      failure_url: input.failureUrl,
      cancelled_url: input.cancelledUrl,
    };
    if (input.amounts.discount) body.discount = input.amounts.discount;
    if (input.customer && Object.keys(input.customer).length > 0) {
      body.customer = input.customer;
    }
    if (input.metadata && Object.keys(input.metadata).length > 0) {
      body.metadata = input.metadata;
    }
    // POST is NOT retried: a retry after an ambiguous failure could create a second
    // checkout for the same order.
    const res = await this.call(creds, 'POST', '/v1/checkout', body, signal);
    const parsed = this.parseCheckout(res);
    if (!parsed.url || !/^https:\/\//i.test(parsed.url)) {
      throw new NomodApiError(
        'Nomod returned no usable checkout URL',
        200,
        false,
      );
    }
    return { ...parsed, url: parsed.url };
  }

  // Idempotent, so retried on a network error, a 429 or a 5xx.
  async getCheckout(
    creds: NomodCredentials,
    checkoutId: string,
    signal?: AbortSignal,
  ): Promise<NomodCheckoutResponse> {
    const res = await this.call(
      creds,
      'GET',
      `/v1/checkout/${safeId(checkoutId)}`,
      undefined,
      signal,
    );
    return this.parseCheckout(res);
  }

  async refund(
    creds: NomodCredentials,
    checkoutId: string,
    input: {
      amount: string;
      idempotencyKey: string;
      reason?: string;
      referenceId?: string;
    },
  ): Promise<NomodRefundResponse> {
    const body: Record<string, unknown> = {
      amount: input.amount,
      idempotency_key: input.idempotencyKey,
    };
    if (input.reason) body.reason = input.reason;
    if (input.referenceId) body.reference_id = input.referenceId;
    // POST, not retried here: the caller retries with the SAME idempotency key.
    const res = await this.call(
      creds,
      'POST',
      `/v1/checkout/${safeId(checkoutId)}/refund`,
      body,
    );
    const refundId =
      typeof res.refund_id === 'string' && res.refund_id ? res.refund_id : null;
    if (!refundId) {
      throw new NomodApiError('Nomod returned no refund id', 200, true);
    }
    // res.amount is deliberately never read (the docs describe it as an integer,
    // which cannot be reconciled with a decimal request).
    return {
      refundId,
      status: typeof res.status === 'string' ? res.status : null,
    };
  }

  // A harmless authenticated read: asks for a checkout that cannot exist. A 401/403
  // means the key is rejected; a 404 or 400 means the key was accepted and the id
  // simply is not there. INFERRED from the documented 200/400 behaviour, not from a
  // documented "ping" endpoint, so the admin screen says so.
  async testConnection(
    creds: NomodCredentials,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      await this.call(
        creds,
        'GET',
        '/v1/checkout/00000000-0000-0000-0000-000000000000',
        undefined,
        undefined,
        { allow: [400, 404] },
      );
      return { ok: true, message: 'Nomod accepted the API key.' };
    } catch (err) {
      if (err instanceof NomodConfigError) {
        return { ok: false, message: err.message };
      }
      if (err instanceof NomodApiError) {
        if (err.status === 401 || err.status === 403) {
          return { ok: false, message: 'Nomod rejected the API key.' };
        }
        return {
          ok: false,
          message: err.status
            ? `Nomod answered with an unexpected status (${err.status}).`
            : 'Could not reach Nomod.',
        };
      }
      return { ok: false, message: 'Could not reach Nomod.' };
    }
  }

  private parseCheckout(res: Record<string, unknown>): NomodCheckoutResponse {
    const id = typeof res.id === 'string' && res.id ? res.id : null;
    if (!id)
      throw new NomodApiError('Nomod returned no checkout id', 200, true);
    return {
      id,
      url: typeof res.url === 'string' ? res.url : null,
      status: typeof res.status === 'string' ? res.status : null,
      amount: res.amount,
      currency: typeof res.currency === 'string' ? res.currency : null,
      referenceId:
        typeof res.reference_id === 'string' ? res.reference_id : null,
    };
  }

  // One request, bounded in time, never following a redirect. Only a documented
  // 200 is a success (plus the statuses a caller explicitly allows); a 400 and every
  // other status, and a body that is not a JSON object, are one generic gateway
  // error. Nothing from the response body reaches an error message.
  private async call(
    creds: NomodCredentials,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    opts?: { allow?: number[] },
  ): Promise<Record<string, unknown>> {
    if (!creds.apiKey?.trim()) {
      throw new NomodApiError('Nomod API key is not configured', null, false);
    }
    const base = resolveNomodBase(creds.baseUrl);
    const attempts = method === 'GET' ? GET_ATTEMPTS : 1;
    let lastError: NomodApiError | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), NOMOD_REQUEST_TIMEOUT_MS);
      const onAbort = () => timeout.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      let retry = false;
      try {
        const res = await this.fetchImpl(`${base}${path}`, {
          method,
          redirect: 'manual',
          signal: timeout.signal,
          headers: {
            'X-API-KEY': creds.apiKey,
            Accept: 'application/json',
            ...(body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (opts?.allow?.includes(res.status)) return {};
        if (res.status === 200) {
          const parsed: unknown = await res.json().catch(() => null);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new NomodApiError(
              'Nomod returned an unreadable body',
              200,
              true,
            );
          }
          return parsed as Record<string, unknown>;
        }
        lastError = new NomodApiError(
          `Nomod ${method} failed with status ${res.status}`,
          res.status,
          res.status >= 500,
        );
        retry = method === 'GET' && (res.status === 429 || res.status >= 500);
      } catch (err) {
        if (err instanceof NomodApiError) throw err;
        // A network error, a timeout or a caller abort: the request may or may not
        // have reached Nomod. Only a GET is tried again.
        lastError = new NomodApiError(
          `Nomod ${method} did not complete`,
          null,
          true,
        );
        retry = method === 'GET' && !signal?.aborted;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      if (!retry) break;
      if (attempt < attempts) await this.sleep(300 * attempt);
    }
    logger.warn('nomod request failed', { method, status: lastError?.status });
    throw lastError ?? new NomodApiError('Nomod request failed', null, true);
  }
}
