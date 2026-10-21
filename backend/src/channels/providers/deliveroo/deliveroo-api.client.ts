import { createHash } from 'crypto';

// Deliveroo SANDBOX HTTP client (E2). SANDBOX ONLY: no production host exists in
// this file, and every request is checked against the allow-list below before it
// leaves, so a bug elsewhere cannot send a sandbox credential to another host.
// Hosts and the token flow are VERIFIED from the public docs (authentication.md,
// patch-order reference, 2026-10-21). The two token URLs the docs list disagree
// (plan Q4); the sandbox host from authentication.md is used.
export const DELIVEROO_SANDBOX = {
  tokenUrl: 'https://auth-sandbox.developers.deliveroo.com/oauth2/token',
  orderBase: 'https://api-sandbox.developers.deliveroo.com/order',
  menuBase: 'https://api-sandbox.developers.deliveroo.com/menu',
} as const;

const ALLOWED_HOSTS = new Set([
  'auth-sandbox.developers.deliveroo.com',
  'api-sandbox.developers.deliveroo.com',
]);

export interface DeliverooCredentials {
  clientId: string;
  clientSecret: string;
}

export interface DeliverooResponse {
  status: number;
  // Parsed JSON body or null. Never logged or surfaced to a merchant.
  json: unknown;
  retryAfterSeconds: number | null;
}

// A failure that is safe to show: fixed wording, no URL, no body, no token.
export class DeliverooCallError extends Error {}

// Deliveroo's own short error code (`{"error":{"code":"..."}}`), only if it looks
// like a code. Everything else in a response body is ignored.
export function errorCodeOf(json: unknown): string | null {
  const e = (json as { error?: { code?: unknown } } | null)?.error;
  return typeof e?.code === 'string' && /^[a-z_]{1,40}$/.test(e.code)
    ? e.code
    : null;
}

export function assertSandboxUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname) || u.port) {
    throw new DeliverooCallError('Refusing to call a non-sandbox host');
  }
  return u;
}

// Platform-level sandbox fallback (env). Read per call so a rotation needs no
// restart; presence is all that is ever inspected outside this function.
export function platformCredentials(): DeliverooCredentials | null {
  const clientId = process.env.DELIVEROO_SANDBOX_CLIENT_ID;
  const clientSecret = process.env.DELIVEROO_SANDBOX_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// The connection's own credentials win; the platform fallback is used only when
// the connection has none of its own. Never a mix of the two.
export function resolveCredentials(
  own: Record<string, string> | null,
): DeliverooCredentials | null {
  if (own?.clientId && own?.clientSecret) {
    return { clientId: own.clientId, clientSecret: own.clientSecret };
  }
  return platformCredentials();
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

const TOKEN_SAFETY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

export class DeliverooApiClient {
  // Overridable seams for tests.
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  now: () => number = () => Date.now();

  private readonly tokens = new Map<string, CachedToken>();
  private readonly inflight = new Map<string, Promise<string>>();

  // The cache key is a hash of the client id AND secret, so a rotated secret
  // never reuses a token minted with the old one.
  private keyOf(c: DeliverooCredentials): string {
    return createHash('sha256')
      .update(`${c.clientId}\u0000${c.clientSecret}`)
      .digest('hex');
  }

  invalidate(c: DeliverooCredentials): void {
    this.tokens.delete(this.keyOf(c));
  }

  // OAuth2 client credentials, cached until shortly before expires_in (300 s,
  // VERIFIED) and refreshed on demand. Concurrent callers share one request.
  async token(c: DeliverooCredentials): Promise<string> {
    const key = this.keyOf(c);
    const hit = this.tokens.get(key);
    if (hit && hit.expiresAtMs - TOKEN_SAFETY_MS > this.now()) return hit.token;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.fetchToken(c)
      .then((t) => {
        this.tokens.set(key, t);
        return t.token;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async fetchToken(c: DeliverooCredentials): Promise<CachedToken> {
    const url = assertSandboxUrl(DELIVEROO_SANDBOX.tokenUrl);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        },
        body: new URLSearchParams({
          client_id: c.clientId,
          client_secret: c.clientSecret,
          grant_type: 'client_credentials',
        }).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new DeliverooCallError('Could not reach the Deliveroo sandbox');
    }
    if (res.status === 400 || res.status === 401) {
      throw new DeliverooCallError('Deliveroo did not accept the credentials');
    }
    if (!res.ok) {
      throw new DeliverooCallError(
        `Deliveroo token request failed (${res.status})`,
      );
    }
    const body = (await res.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (typeof body?.access_token !== 'string' || !body.access_token) {
      throw new DeliverooCallError('Deliveroo sent no access token');
    }
    const ttl =
      typeof body.expires_in === 'number' && body.expires_in > 0
        ? body.expires_in
        : 300;
    return {
      token: body.access_token,
      expiresAtMs: this.now() + ttl * 1000,
    };
  }

  // One authenticated call. A 401 drops the cached token and retries ONCE with a
  // fresh one (the token may have been revoked or expired early).
  async request(
    creds: DeliverooCredentials,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    body?: unknown,
  ): Promise<DeliverooResponse> {
    const target = assertSandboxUrl(url);
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(creds);
      let res: Response;
      try {
        res = await this.fetchImpl(target.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new DeliverooCallError('Could not reach the Deliveroo sandbox');
      }
      if (res.status === 401 && attempt === 0) {
        this.invalidate(creds);
        continue;
      }
      const ra = Number(res.headers.get('retry-after'));
      return {
        status: res.status,
        json: await res.json().catch(() => null),
        retryAfterSeconds: Number.isFinite(ra) && ra > 0 ? ra : null,
      };
    }
  }
}
