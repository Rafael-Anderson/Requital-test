# deploy/

Canonical copies of VPS config that otherwise lives only on the server.

## `Caddyfile`

Mirror of `/etc/caddy/Caddyfile` on the production VPS (`187.52.114.246`).
Captured verbatim on 2026-08-31; the only repo-side addition is the leading `#`
comment block (a no-op for Caddy).

### What it does

See the comment header in the file itself. The short version:

| Host | Backend | TLS |
|---|---|---|
| `requital.io`, `www.requital.io` | 301 → `admin.requital.io` | automatic |
| `admin.requital.io` | `:3001` (admin) | automatic (HTTP-01) |
| `api.requital.io` | `:3000` (backend) | automatic (HTTP-01) |
| `*.requital.io` | `:3002` (storefront) | **one Cloudflare DNS-01 wildcard cert** |
| any other host (`https://` catch-all) | `:3002` (storefront) | **on-demand TLS**, gated by `on_demand_tls { ask ... }` → `GET /domains/verify` |

Subdomain shops (`<shop>.requital.io`) are served by the wildcard block and ride
a single proactively-issued Cloudflare wildcard cert — they never touch
on-demand TLS. Only genuinely-custom merchant domains hit the `https://`
catch-all and trigger an on-demand cert, and only if `GET /domains/verify` on the
backend returns 200 for that host.

### Secrets — not in this repo

`*.requital.io`'s `tls { dns cloudflare {env.CLOUDFLARE_API_TOKEN} }` reads
`CLOUDFLARE_API_TOKEN` from `/etc/caddy/caddy.env` (systemd `EnvironmentFile`,
mode `600`). That file is a secret and is **not** committed here, same as
`backend/.env`. If you provision a fresh box, recreate it:

```
# /etc/caddy/caddy.env
CLOUDFLARE_API_TOKEN=<a Cloudflare token with DNS:Edit on the requital.io zone>
```

### Deploying a change

Caddy runs under systemd as the `caddy` user
(`ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile`,
`ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force`).
There is no automation — it is a manual copy + reload:

```bash
# 1. Validate locally (or on the box) before touching the live file.
caddy validate --config deploy/Caddyfile

# 2. On the VPS: back up the current file first.
ssh -i ~/.ssh/hostinger_vps root@187.52.114.246 \
  'cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M%S)'

# 3. Copy the new file up. Strip the repo-only leading comment block if you
#    want the live file to stay byte-identical to history; Caddy does not care
#    either way.
scp -i ~/.ssh/hostinger_vps deploy/Caddyfile root@187.52.114.246:/etc/caddy/Caddyfile

# 4. Reload (zero-downtime) and confirm.
ssh -i ~/.ssh/hostinger_vps root@187.52.114.246 \
  'systemctl reload caddy && sleep 1 && systemctl status caddy --no-pager | head -20'
```

If `systemctl reload caddy` fails, the previous config stays live (Caddy
validates before swapping). Restore from the `.bak-*` file if needed.

Keep this file in sync when the live Caddyfile changes on the box — check it
during any deploy that touches routing or TLS.

### On-demand TLS: abuse resistance and ACME backoff (Phase 4)

There is deliberately **no `on_demand_tls { rate_limit ... burst ... }`** block.
Those subdirectives were removed from Caddy in 2.7 (the box runs 2.11) — adding
them makes `caddy validate` fail. Caddy's current design puts *all* on-demand
gating on the `ask` endpoint:

- **`ask` → `GET http://localhost:3000/domains/verify?domain=<host>`** returns 200
  only for a `<sub>.requital.io` host or a `customDomain` whose
  `customDomainStatus = 'verified'` (Phase 2). A `pending` / `verifying` /
  `failed` / unknown host gets 404, and Caddy will not even *attempt* ACME for
  it. So a squatted or bogus custom domain never reaches Let's Encrypt.
- That endpoint additionally carries a **60 req/min per-IP throttle**
  (`@Throttle` in `domains.controller.ts`) — a cheap indexed lookup, but this
  caps an external prober hitting it directly.
- **ACME failure backoff is Caddy's own, not something we configure.** When an
  on-demand issuance fails (DNS not pointed at the box yet, ACME rate limit,
  etc.) Caddy caches that failure in memory for a short window and serves the
  TLS handshake failure without retrying ACME on every connection; internal
  obtain retries use CertMagic's exponential backoff. A `systemctl reload caddy`
  clears that in-memory failure cache if you need an immediate re-attempt after
  fixing the underlying cause. (Check the exact negative-cache window in the
  Caddy docs for the pinned version if you need the precise number — it is
  short, on the order of a minute.)
- **No cert pre-warm.** When a domain flips to `verified`, the first real
  visitor eats one ACME handshake (~1–3s once), then the cert is cached ~90
  days. An app-side "hit the domain over HTTPS on the verified transition" is
  not worth the added failure modes (the domain's DNS/proxy may not be fully
  live the instant the TXT record verifies) for a one-time few-second saving on
  one request.

### Post-deploy check: custom-domain customer sessions (Phase 5)

The same-origin `/api/*` proxy (storefront `next.config.ts` rewrites) plus the
`__Secure-` customer-cookie fix (`backend/src/common/cookies.ts`) are what make a
customer session actually persist on a connected custom domain. The true
cross-*site* case can't be reproduced locally (localhost can't be two registered
domains), so verify it once against prod after the deploy that carries Phase 5:

1. On **`irmain.com`** (a live custom-domain shop), open the storefront, register
   or log in as a customer.
2. **Reload the page.** You should still be logged in (the account menu still
   shows your name; `/account` doesn't bounce to login).
3. In devtools → Application → Cookies for `irmain.com`, confirm
   `__Secure-req-customer-at` is present with `Path=/public/<slug>`,
   `SameSite=Strict`, `Secure`, `HttpOnly`. There must be **no**
   `__Host-req-customer-at` (that shape is silently dropped by the browser — it
   was the latent bug).
4. Add an address or edit the profile (a CSRF-protected mutation) — it should
   succeed, not 403.
5. Repeat 1–4 on a plain `<sub>.requital.io` shop (e.g. `dff.requital.io`) to
   confirm no regression there.
