// Signed "this call comes from the storefront server" header for the hops the
// Next server itself makes to the backend (proxy.ts host resolution, SSR
// fetches in lib/api.ts). Without it every such call reaches the backend from
// 127.0.0.1 and shares ONE per-IP throttle bucket per route, so a busy shop's
// page views can 429 the host lookup of every other shop.
//
// The backend (common/internal-auth.ts) verifies `t=<unix>,sig=<hex>` where
// sig = HMAC_SHA256(INTERNAL_API_SECRET, METHOD "\n" PATH "\n" t) and, only
// then, gives the caller its own throttle bucket. The secret buys nothing else:
// no authentication, no tenant access. Unset secret = no header = today's
// behaviour. Web Crypto, not node:crypto, because lib/api.ts is also bundled
// for the browser (where the secret does not exist and this returns {}).

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signInternal(secret: string, method: string, path: string, nowSeconds: number): Promise<string> {
  const t = String(nowSeconds);
  return `t=${t},sig=${await hmacHex(secret, `${method.toUpperCase()}\n${path}\n${t}`)}`;
}

// The right-most X-Forwarded-For entry is the one Caddy wrote (it overwrites a
// client-supplied header), so a client cannot choose it. The backend validates
// it again and believes it only when the signature checks out.
export function clientIpFromForwardedFor(value: string | null | undefined): string | undefined {
  const last = value?.split(",").pop()?.trim();
  return last ? last : undefined;
}

export async function internalAuthHeaders(
  method: string,
  url: string,
  clientIp?: string,
): Promise<Record<string, string>> {
  const secret = typeof window === "undefined" ? process.env.INTERNAL_API_SECRET?.trim() : undefined;
  if (!secret) return {};
  const headers: Record<string, string> = {
    "X-Internal-Auth": await signInternal(secret, method, new URL(url).pathname, Math.floor(Date.now() / 1000)),
  };
  if (clientIp) headers["X-Internal-Client-IP"] = clientIp;
  return headers;
}
