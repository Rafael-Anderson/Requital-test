import 'dotenv/config';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { StructuredLoggerService } from './common/logging/structured-logger.service';
import { validateEnv } from './common/env-validation';
import { DomainsService } from './domains/domains.service';

// Constructed standalone (no Nest DI needed yet) so even the fail-fast
// validation error itself goes out as a structured JSON line, not a raw
// console.error — this runs before NestFactory.create() has a chance to
// wire the same logger in as the app's own.
const bootLogger = new StructuredLoggerService();
validateEnv(bootLogger);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    // Every Logger instance app-wide (new Logger(X), Nest's own internal
    // bootstrap logging, everything) is routed through this one JSON
    // formatter — see structured-logger.service.ts's own comment.
    logger: bootLogger,
  });
  // Enforcing, not report-only — this is a JSON API plus one HTML surface
  // (invoices/invoice-html.ts's styled text/html document). That template's
  // one <style> block is static (no interpolated data inside it — all
  // per-invoice values are elsewhere in the body), so 'unsafe-inline' is
  // scoped to style-src only; script-src stays strict since nothing here
  // has a legitimate reason to run an inline script. defaultSrc/objectSrc
  // 'none'/'self' blocks the classic plugin/object-embed vector; frameSrc
  // 'none' plus X-Frame-Options (via frameguard, on by default in helmet)
  // stops this API from ever being framed.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
        },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
      // /uploads/* product/theme images are deliberately loaded cross-origin
      // — admin (:3001) and storefront (:3002) render them straight from
      // this API's own origin, not proxied through their own server. The
      // default same-origin CORP would silently block every image in both
      // frontends; cross-origin is the correct policy for a media host, not
      // a relaxation done for convenience.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Merchant auth landed — tighten from the prior wide-open CORS to an
  // explicit allowlist. Storefront (:3002) calls the @Public() routes under
  // /public/:shopSlug with no token at all — still needs to be in this
  // allowlist for the browser to permit the request.
  //
  // Every shop's storefront is now reachable at its own {subdomain}.
  // requital.io host, or at a merchant-connected custom domain (see
  // "Domains" in CLAUDE.md) — neither shape can be enumerated as a static
  // list, so ADMIN_ORIGINS (local dev + the fixed admin/api hosts) is
  // checked first as a fast path, then a *.requital.io regex, then a DB
  // lookup against shop.customDomain for anything else.
  //
  // `credentials: true` — added for the httpOnly-cookie session migration
  // (security audit finding #1, platform admin is the first tier moved).
  // Required for the browser to send/accept Set-Cookie on a cross-origin
  // (but same-*site*) request; a wildcard `Access-Control-Allow-Origin`
  // becomes invalid the moment credentials are involved, so this only works
  // because `origin` was already a real per-request allowlist function, not
  // `*`, before this line existed.
  const allowedOrigins = (
    process.env.ADMIN_ORIGINS ?? 'http://localhost:3001,http://localhost:3002'
  ).split(',');
  const REQUITAL_SUBDOMAIN_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?requital\.io$/;
  const domainsService = app.get(DomainsService);
  app.enableCors({
    origin: (origin, callback) => {
      // No Origin header at all — a server-to-server call (curl, a webhook,
      // Caddy's own health check), never a browser request CORS gates.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (REQUITAL_SUBDOMAIN_ORIGIN.test(origin)) return callback(null, true);
      domainsService
        .isCustomDomain(origin.replace(/^https?:\/\//, ''))
        .then((allowed) => callback(null, allowed))
        .catch(() => callback(null, false));
    },
    credentials: true,
  });
  // cookie-parser is registered in AppModule.configure() instead of here —
  // see that file's own comment for why (main.ts's bootstrap() never runs
  // under Jest, so a middleware only mounted here would be invisible to
  // every e2e spec).
  // Local-disk image uploads — only ever served from here when
  // STORAGE_PROVIDER=local (the default; see src/storage/). Left
  // unconditional rather than gated on the active provider: every file
  // written before Phase 6 (and any written by a deployment that later
  // switches away from local) still needs to keep resolving. Serves both
  // pre-Phase-6 keys (no shopId path segment) and current shop-scoped keys
  // identically — Express's static middleware doesn't care about the
  // shape of what's under this root, just that it maps to a real file.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
