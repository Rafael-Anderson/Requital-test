import 'dotenv/config';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  // Merchant auth landed — tighten from the prior wide-open CORS to an
  // explicit allowlist. Bearer tokens go in a header, not a cookie, so
  // `credentials: true` isn't needed here.
  const allowedOrigins = (
    process.env.ADMIN_ORIGINS ?? 'http://localhost:3001'
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
