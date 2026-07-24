import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Dev-only login for the seeded shop — not a real credential, just makes
// the seeded data immediately usable through the auth flow.
const DEV_ADMIN_EMAIL = 'admin@test-shop.com';
const DEV_ADMIN_PASSWORD = 'dev-password-123';

async function main() {
  const shop = await prisma.shop.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'Test Flower Shop',
      subdomain: 'test-shop',
      currency: 'AED',
    },
  });

  await prisma.outlet.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, shopId: shop.id, name: 'Main Branch' },
  });

  await prisma.user.upsert({
    where: { email: DEV_ADMIN_EMAIL },
    update: {},
    create: {
      shopId: shop.id,
      name: 'Admin',
      email: DEV_ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(DEV_ADMIN_PASSWORD, 10),
      role: 'admin',
    },
  });

  const flowers = await prisma.category.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, shopId: shop.id, name: 'Flowers', slug: 'flowers' },
  });
  const gifts = await prisma.category.upsert({
    where: { id: 2 },
    update: {},
    create: { id: 2, shopId: shop.id, name: 'Gifts', slug: 'gifts' },
  });

  const rosesTag = await prisma.tag.upsert({
    where: { shopId_name: { shopId: shop.id, name: 'roses' } },
    update: {},
    create: { shopId: shop.id, name: 'roses' },
  });
  const boxesTag = await prisma.tag.upsert({
    where: { shopId_name: { shopId: shop.id, name: 'boxes' } },
    update: {},
    create: { shopId: shop.id, name: 'boxes' },
  });

  await prisma.product.upsert({
    where: { shopId_sku: { shopId: shop.id, sku: 'ROSE-RED-01' } },
    update: {},
    create: {
      shopId: shop.id,
      name: 'Red Rose Bouquet',
      sku: 'ROSE-RED-01',
      price: 149.0,
      thumbnail: 'https://example.com/images/red-rose-bouquet.jpg',
      shortSummary: 'A dozen fresh red roses.',
      status: 'Available',
      productcategory: { create: [{ categoryId: flowers.id }] },
      producttag: { create: [{ tagId: rosesTag.id }] },
    },
  });

  await prisma.product.upsert({
    where: { shopId_sku: { shopId: shop.id, sku: 'GIFT-BOX-01' } },
    update: {},
    create: {
      shopId: shop.id,
      name: 'Chocolate Gift Box',
      sku: 'GIFT-BOX-01',
      price: 89.0,
      thumbnail: 'https://example.com/images/chocolate-gift-box.jpg',
      shortSummary: 'Assorted chocolates in a keepsake box.',
      status: 'Available',
      productcategory: { create: [{ categoryId: gifts.id }] },
      producttag: { create: [{ tagId: boxesTag.id }] },
    },
  });
}

main()
  .then(async () => {
    console.log(`Seeded dev admin login: ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD}`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
