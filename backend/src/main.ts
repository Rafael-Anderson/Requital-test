import 'dotenv/config';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { StructuredLoggerService } from './common/logging/structured-logger.service';
import { validateEnv } from './common/env-validation';

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
  // explicit allowlist. Bearer tokens go in a header, not a cookie, so
  // `credentials: true` isn't needed here. Storefront (:3002) calls the
  // @Public() routes under /public/:shopSlug with no token at all — still
  // needs to be in this allowlist for the browser to permit the request.
  const allowedOrigins = (
    process.env.ADMIN_ORIGINS ?? 'http://localhost:3001,http://localhost:3002'
  ).split(',');
  app.enableCors({ origin: allowedOrigins });
  // Local-disk product image uploads — see product-image-upload.config.ts
  // for the storage/serving tradeoff this implies.
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
