# N6c: TRUST_PROXY / real client IP (handoff, coordinator removes before merge)

Branch `feat/trust-proxy-client-ip`. No migration. No functional change to Caddyfile or next.config.ts.

## Production value
`TRUST_PROXY=loopback` in backend/.env + `pm2 restart requital-backend`. Correct for both chains. Full section: docs/runbook.md "Client IP behind the proxies (TRUST_PROXY)" (value, why not a hop count, verification from two networks, rollback = unset + restart). Pre-step: confirm :3000 and :3002 are not reachable from outside (INFERRED closed, not recorded in the repo); :3002 open would let a client choose its IP because Next forwards a client-supplied X-Forwarded-For untouched and the backend then trusts the loopback peer.

## Chain (VERIFIED locally: Caddy v2.10.0 -> Next 16.3.0 dev rewrite -> echo server)
- A client -> Caddy -> backend: socket 127.0.0.1, X-Forwarded-For = client socket address (client's own XFF overwritten; X-Real-IP / Forwarded / CF-Connecting-IP pass through untouched, never read).
- B client -> Caddy -> Next :3002 -> `/api/*` rewrite -> backend: socket 127.0.0.1 (Next), XFF = the single value Caddy wrote. PREMISE CORRECTION: Next 16.3's proxy-request.js (httpxy) does NOT set `xfwd`, so it appends nothing; hop counts for A and B are therefore the same (1), but `loopback` is preferred (handles a future append, refuses a non-local peer).
- Direct to Next :3002 with a spoofed XFF: forwarded verbatim (see :3002 caveat).
- Caddy with `trusted_proxies static <range>` appends instead of overwriting ("spoof, real, edge"): only for a CDN setup (runbook). Cloudflare proxying is INFERRED off (wildcard proxy needs Enterprise; not recorded).
- SSR/RSC and proxy.ts fetches share one bucket (VPS address), global 100/min; pre-existing, unchanged, now isolated from real users.

## Code
common/trust-proxy.ts (strict parser, no trust-all), AppModule.onModuleInit (applies; HttpAdapterHost, so e2e and main.ts share it), env-validation (fail fast), common/client-ip.ts + client-ip-throttler.guard.ts (throttle key: IPv4-mapped = IPv4, IPv6 per /64), session-meta comment. Only consumer of the address is req.ip (grep: no other req.ip / x-forwarded / remoteAddress use). Side effect: with trust on, `req.protocol` honours X-Forwarded-Proto, so platform-admin `GET /platform-admin/settings` webhook URLs show https.

## Tests
backend/test/trust-proxy.e2e-spec.ts (33), trust-proxy.spec.ts, client-ip.spec.ts, env-validation.spec.ts additions. Injection proofs: trust-all (8 fail), never applied (11 fail), stock throttler guard (IPv6 /64 case fails), unset treated as loopback (2 fail), tracker reads raw XFF (3 fail), validation off (15 fail).
