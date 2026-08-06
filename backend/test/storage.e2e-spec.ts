import 'dotenv/config';
import { existsSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { UPLOAD_ROOT } from '../src/storage/providers/local-storage.provider';

interface AuthResponse {
  accessToken: string;
}
interface UploadResponse {
  url: string;
  thumbnailUrl: string;
  mediumUrl: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// A real, valid 1x1 PNG — the upload pipeline sniffs actual magic bytes,
// so a fake/placeholder buffer would be correctly rejected.
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// Path relative to /uploads/ back to a real filesystem path under
// UPLOAD_ROOT, since the local provider is what CI/local dev actually run.
function fsPathForUploadUrl(url: string): string {
  const key = url.replace(/^\/uploads\//, '');
  return join(UPLOAD_ROOT, ...key.split('/'));
}

describe('Storage / uploads (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const shopSlug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Shop Admin',
        email: `${shopSlug}@test.com`,
        password: 'password123',
        shopName: `${shopSlug} Shop`,
        subdomain: shopSlug,
      })
      .expect(201);
    return { adminToken: body<AuthResponse>(signup).accessToken };
  }

  describe('validation', () => {
    it('accepts a real valid image and returns url/thumbnailUrl/mediumUrl', async () => {
      const { adminToken } = await setupShop('storage-valid');
      const res = await request(app.getHttpServer())
        .post('/products/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', VALID_PNG, { filename: 'photo.png', contentType: 'image/png' })
        .expect(201);

      const { url, thumbnailUrl, mediumUrl } = body<UploadResponse>(res);
      expect(url).toMatch(/^\/uploads\/products\/\d+\/[a-f0-9-]+\.png$/);
      expect(thumbnailUrl).toContain('_thumb.png');
      expect(mediumUrl).toContain('_medium.png');
    });

    it('rejects a file with real PDF magic bytes disguised with a .jpg name', async () => {
      const { adminToken } = await setupShop('storage-pdf');
      const pdfBytes = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj', 'ascii');
      await request(app.getHttpServer())
        .post('/products/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', pdfBytes, { filename: 'invoice.jpg', contentType: 'image/jpeg' })
        .expect(400);
    });

    it('rejects SVG at both the extension and content level', async () => {
      const { adminToken } = await setupShop('storage-svg');
      const svgBytes = Buffer.from(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
        'ascii',
      );
      await request(app.getHttpServer())
        .post('/products/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', svgBytes, { filename: 'logo.svg', contentType: 'image/svg+xml' })
        .expect(400);
    });

    // busboy (multer's underlying multipart parser) already applies
    // path.basename() to every uploaded filename unless `preservePath` is
    // explicitly set (it isn't here) — a raw "../../../etc/passwd.png"
    // never survives multipart parsing intact; by the time file.originalname
    // reaches this app it's already been reduced to "passwd.png". Verified
    // by reading busboy's own source (node_modules/busboy/lib/types/
    // multipart.js), not assumed. isFilenameSafe()/sanitizeFilename() are
    // still real, unit-tested defense-in-depth (see filename.spec.ts) for
    // anything that isn't a directory-separator-based traversal — a raw
    // ".." with no separator is what actually reaches the server and is
    // what this test exercises end-to-end.
    it('rejects a suspicious filename containing ".." even with no path separator', async () => {
      const { adminToken } = await setupShop('storage-traversal');
      await request(app.getHttpServer())
        .post('/products/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', VALID_PNG, {
          filename: '..png',
          contentType: 'image/png',
        })
        .expect(400);
    });
  });

  describe('image resizing', () => {
    it('writes _thumb and _medium variants to disk alongside the original', async () => {
      const { adminToken } = await setupShop('storage-resize');
      const res = await request(app.getHttpServer())
        .post('/products/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', VALID_PNG, { filename: 'photo.png', contentType: 'image/png' })
        .expect(201);

      const { url, thumbnailUrl, mediumUrl } = body<UploadResponse>(res);
      expect(existsSync(fsPathForUploadUrl(url))).toBe(true);
      expect(existsSync(fsPathForUploadUrl(thumbnailUrl))).toBe(true);
      expect(existsSync(fsPathForUploadUrl(mediumUrl))).toBe(true);
    });
  });

  describe('per-shop scoping — adversarial', () => {
    it("shop B cannot delete shop A's uploaded file, even with a valid admin token", async () => {
      const shopA = await setupShop('storage-tenant-a');
      const shopB = await setupShop('storage-tenant-b');

      const uploadRes = await request(app.getHttpServer())
        .post('/products/upload')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .attach('file', VALID_PNG, { filename: 'photo.png', contentType: 'image/png' })
        .expect(201);
      const { url } = body<UploadResponse>(uploadRes);
      const key = url.replace(/^\/uploads\//, '');
      const fsPath = fsPathForUploadUrl(url);
      expect(existsSync(fsPath)).toBe(true);

      // Shop B, a genuinely authenticated admin of a *different* shop,
      // attempts to delete shop A's file by key.
      await request(app.getHttpServer())
        .delete('/uploads')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ key })
        .expect(404);

      // Untouched by the rejected attempt.
      expect(existsSync(fsPath)).toBe(true);

      // Shop A can delete its own file.
      await request(app.getHttpServer())
        .delete('/uploads')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ key })
        .expect(200);
      expect(existsSync(fsPath)).toBe(false);
    });

    it('rejects a delete request for a pre-Phase-6 style key with no shopId segment', async () => {
      const { adminToken } = await setupShop('storage-legacy-key');
      await request(app.getHttpServer())
        .delete('/uploads')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: 'products/some-legacy-uuid.jpg' })
        .expect(404);
    });
  });
});
