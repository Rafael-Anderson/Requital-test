import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../../src/database/database.service';
import { verifySignupEmail } from './verify-signup-email';

export interface ImportShop {
  slug: string;
  token: string;
  outletId: number;
  collectionId: number;
  shopId: number;
}

// Signs a fresh shop up through the real API (admin, default outlet, one
// collection) for the import specs.
export async function setupImportShop(
  app: INestApplication<App>,
  db: DatabaseService,
  prefix: string,
  countryName?: string,
): Promise<ImportShop> {
  const slug = `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({
      name: 'Importer',
      email: `${slug}@test.com`,
      password: 'password123',
      shopName: `${slug} Shop`,
      subdomain: slug,
      ...(countryName ? { country: countryName } : {}),
    })
    .expect(201);
  const body = signup.body as {
    accessToken: string;
    devVerificationLink?: string;
  };
  await verifySignupEmail(app.getHttpServer(), body.devVerificationLink);
  const outlets = await request(app.getHttpServer())
    .get('/outlets')
    .set('Authorization', `Bearer ${body.accessToken}`)
    .expect(200);
  const collection = await request(app.getHttpServer())
    .post('/collections')
    .set('Authorization', `Bearer ${body.accessToken}`)
    .send({ name: 'Imported' })
    .expect(201);
  const shopRows = await db.query<RowDataPacket[]>(
    `SELECT id FROM shop WHERE subdomain = ?`,
    [slug],
  );
  return {
    slug,
    token: body.accessToken,
    outletId: (outlets.body as { id: number }[])[0].id,
    collectionId: (collection.body as { id: number }).id,
    shopId: shopRows[0].id as number,
  };
}
