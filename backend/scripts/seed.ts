// Replaces the old Prisma `prisma/seed.ts` (run via `prisma db seed`) — same
// seed data, plain mysql2 upserts instead of Prisma's nested `upsert`/
// `create: { productcollection: { create: [...] } }` shape. Idempotent the
// same way the old script was: safe to re-run against an already-seeded
// database.
import 'dotenv/config';
import { createPool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import * as bcrypt from 'bcryptjs';

// Dev-only login for the seeded shop — not a real credential, just makes
// the seeded data immediately usable through the auth flow.
const DEV_ADMIN_EMAIL = 'admin@test-shop.com';
const DEV_ADMIN_PASSWORD = 'dev-password-123';

async function upsertTag(conn: PoolConnection, shopId: number, name: string): Promise<number> {
  await conn.execute(
    `INSERT INTO tag (shopId, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = id`,
    [shopId, name],
  );
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM tag WHERE shopId = ? AND name = ?`,
    [shopId, name],
  );
  return rows[0].id as number;
}

async function ensureProduct(
  conn: PoolConnection,
  data: {
    shopId: number;
    name: string;
    slug: string;
    sku: string;
    price: number;
    thumbnail: string;
    shortSummary: string;
    status: string;
  },
  collectionId: number,
  tagId: number,
): Promise<void> {
  const [existing] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM product WHERE shopId = ? AND sku = ?`,
    [data.shopId, data.sku],
  );
  if (existing.length > 0) return;
  const [result] = await conn.query<ResultSetHeader>(
    `INSERT INTO product (shopId, name, slug, sku, price, thumbnail, shortSummary, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.shopId, data.name, data.slug, data.sku, data.price, data.thumbnail, data.shortSummary, data.status],
  );
  const productId = result.insertId;
  await conn.execute(
    `INSERT INTO productcollection (productId, collectionId) VALUES (?, ?)`,
    [productId, collectionId],
  );
  await conn.execute(`INSERT INTO producttag (productId, tagId) VALUES (?, ?)`, [
    productId,
    tagId,
  ]);
}

async function main() {
  const pool = createPool({ uri: process.env.DATABASE_URL });
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `INSERT INTO shop (id, name, subdomain, currency) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [1, 'Test Flower Shop', 'test-shop', 'AED'],
    );
    await conn.execute(
      `INSERT INTO outlet (id, shopId, name) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [1, 1, 'Main Branch'],
    );

    const [existingUsers] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM user WHERE email = ?`,
      [DEV_ADMIN_EMAIL],
    );
    if (existingUsers.length === 0) {
      await conn.execute(
        `INSERT INTO user (shopId, name, email, passwordHash, role) VALUES (?, ?, ?, ?, ?)`,
        [1, 'Admin', DEV_ADMIN_EMAIL, await bcrypt.hash(DEV_ADMIN_PASSWORD, 10), 'admin'],
      );
    }

    await conn.execute(
      `INSERT INTO collection (id, shopId, name, slug) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [1, 1, 'Flowers', 'flowers'],
    );
    await conn.execute(
      `INSERT INTO collection (id, shopId, name, slug) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [2, 1, 'Gifts', 'gifts'],
    );

    const rosesTagId = await upsertTag(conn, 1, 'roses');
    const boxesTagId = await upsertTag(conn, 1, 'boxes');

    await ensureProduct(
      conn,
      {
        shopId: 1,
        name: 'Red Rose Bouquet',
        slug: 'red-rose-bouquet',
        sku: 'ROSE-RED-01',
        price: 149.0,
        thumbnail: 'https://example.com/images/red-rose-bouquet.jpg',
        shortSummary: 'A dozen fresh red roses.',
        status: 'Available',
      },
      1,
      rosesTagId,
    );
    await ensureProduct(
      conn,
      {
        shopId: 1,
        name: 'Chocolate Gift Box',
        slug: 'chocolate-gift-box',
        sku: 'GIFT-BOX-01',
        price: 89.0,
        thumbnail: 'https://example.com/images/chocolate-gift-box.jpg',
        shortSummary: 'Assorted chocolates in a keepsake box.',
        status: 'Available',
      },
      2,
      boxesTagId,
    );

    console.log(`Seeded dev admin login: ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD}`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
