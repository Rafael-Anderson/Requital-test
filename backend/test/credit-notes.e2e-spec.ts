import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface IdRow {
  id: number;
}
interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface OrderRow {
  id: number;
  orderitem: { id: number; quantity: number }[];
}
interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  currency: string;
}
interface CreditNoteRow {
  id: number;
  number: string;
  reason: string;
  returnId: number | null;
  currency: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  invoiceId: number;
}
interface ErrorBody {
  message: string | string[];
}

function body<T>(res: Response): T {
  return res.body as T;
}
function msg(res: Response): string {
  const { message } = body<ErrorBody>(res);
  return Array.isArray(message) ? message.join(' ') : message;
}

jest.setTimeout(240000);

// I18N-10. A credit note is a DOCUMENT: it must never move money.
describe('Credit notes (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  let seq = 0;
  const http = () => app.getHttpServer();

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
    db = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}-${seq++}`;
    const signup = await request(http())
      .post('/auth/signup')
      .send({
        name: 'CN Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(http(), body<AuthResponse>(signup).devVerificationLink);
    const outlets = await request(http())
      .get('/outlets')
      .set(auth(adminToken))
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    const collection = await request(http())
      .post('/collections')
      .set(auth(adminToken))
      .send({ name: 'General' })
      .expect(201);
    const product = await request(http())
      .post('/products')
      .set(auth(adminToken))
      .send({
        name: `CN Item ${slug}`,
        price: 100,
        thumbnail: 'https://example.com/x.jpg',
        sku: `CN-${slug}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    const shopRows = await db.query<RowDataPacket[]>(
      `SELECT shopId FROM user WHERE email = ?`,
      [`${slug}@test.com`],
    );
    const shopId = shopRows[0].shopId as number;
    // A real 5% standard rate so the per-line tax capture is non-trivial.
    await db.execute(`UPDATE taxclass SET rate = 5 WHERE shopId = ? AND type = 'standard'`, [shopId]);
    await db.execute(`UPDATE shop SET taxRate = 5, taxInclusive = false WHERE id = ?`, [shopId]);
    return {
      slug,
      adminToken,
      outletId,
      productId: body<IdRow>(product).id,
      shopId,
    };
  }
  type Shop = Awaited<ReturnType<typeof setupShop>>;

  // An order with `quantity` units, walked to `delivered`, with an INVOICE issued.
  async function invoicedOrder(
    shop: Shop,
    quantity = 4,
    outletId = shop.outletId,
    preCapture = false,
  ) {
    const res = await request(http())
      .post('/orders')
      .set(auth(shop.adminToken))
      .send({
        customerName: 'CN Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        orderType: 'delivery',
        outletId,
        items: [{ productId: shop.productId, quantity }],
      })
      .expect(201);
    const created = body<OrderRow>(res);
    for (const status of ['confirmed', 'preparing', 'out_for_delivery', 'delivered']) {
      await request(http())
        .patch(`/orders/${created.id}/status`)
        .set(auth(shop.adminToken))
        .send({ status })
        .expect(200);
    }
    const detail = body<OrderRow>(
      await request(http()).get(`/orders/${created.id}`).set(auth(shop.adminToken)).expect(200),
    );
    if (preCapture) {
      // An order placed before B2's per-line capture: NULL = unknown tax.
      await db.execute(`UPDATE orderitem SET taxRate = NULL, taxAmount = NULL WHERE orderId = ?`, [created.id]);
    }
    const invoice = body<InvoiceRow>(
      await request(http())
        .post('/invoices')
        .set(auth(shop.adminToken))
        .send({ orderId: created.id, type: 'INVOICE' })
        .expect(201),
    );
    return { order: detail, invoice };
  }

  async function makeReturn(shop: Shop, orderId: number, itemId: number, qty: number) {
    const res = await request(http())
      .post(`/orders/${orderId}/returns`)
      .set(auth(shop.adminToken))
      .send({ items: [{ orderItemId: itemId, quantity: qty }], reason: 'damaged', restock: false })
      .expect(201);
    return body<IdRow>(res).id;
  }

  const issue = (token: string, payload: Record<string, unknown>) =>
    request(http()).post('/credit-notes').set(auth(token)).send(payload);

  describe('full credit note', () => {
    it('mirrors the invoice figures, is numbered CN-0001 per shop, renders, and a second one is refused', async () => {
      const shop = await setupShop('cn-full');
      const { order, invoice } = await invoicedOrder(shop);

      const res = await issue(shop.adminToken, { orderId: order.id, reason: 'correction' }).expect(201);
      const cn = body<CreditNoteRow>(res);
      expect(cn.number).toBe('CN-0001');
      expect(cn.reason).toBe('correction');
      expect(cn.returnId).toBeNull();
      expect(cn.invoiceId).toBe(invoice.id);
      expect(cn.currency).toBe(invoice.currency);
      expect(Number(cn.total)).toBe(Number(invoice.total));
      expect(Number(cn.subtotal)).toBe(Number(invoice.subtotal));
      expect(Number(cn.taxAmount)).toBe(Number(invoice.taxAmount));

      await issue(shop.adminToken, { orderId: order.id, reason: 'correction' }).expect(409);

      const list = await request(http())
        .get(`/credit-notes?orderId=${order.id}`)
        .set(auth(shop.adminToken))
        .expect(200);
      expect(body<CreditNoteRow[]>(list).map((c) => c.id)).toEqual([cn.id]);

      const html = await request(http()).get(`/credit-notes/${cn.id}/pdf`).set(auth(shop.adminToken)).expect(200);
      expect(html.text).toContain('Credit Note');
      expect(html.text).toContain('CN-0001');
      expect(html.text).toContain(invoice.invoiceNumber);

      // A different shop's first credit note is CN-0001 too: per-shop sequence.
      const other = await setupShop('cn-full-b');
      const o2 = await invoicedOrder(other, 1);
      const cn2 = await issue(other.adminToken, { orderId: o2.order.id, reason: 'correction' }).expect(201);
      expect(body<CreditNoteRow>(cn2).number).toBe('CN-0001');
    });

    it('cancellation needs a cancelled order; return needs returnId; others forbid it; no invoice = 400', async () => {
      const shop = await setupShop('cn-validate');
      const { order } = await invoicedOrder(shop, 1);
      expect(msg(await issue(shop.adminToken, { orderId: order.id, reason: 'cancellation' }).expect(400))).toContain('cancelled');
      await issue(shop.adminToken, { orderId: order.id, reason: 'return' }).expect(400);
      await issue(shop.adminToken, { orderId: order.id, reason: 'correction', returnId: 1 }).expect(400);
      await issue(shop.adminToken, { orderId: order.id, reason: 'refund' }).expect(400);

      const noInvoice = await request(http())
        .post('/orders')
        .set(auth(shop.adminToken))
        .send({
          customerName: 'X',
          customerPhone: '0500000099',
          customerAddress: '1 St',
          orderType: 'delivery',
          outletId: shop.outletId,
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(201);
      expect(
        msg(await issue(shop.adminToken, { orderId: body<IdRow>(noInvoice).id, reason: 'correction' }).expect(400)),
      ).toContain('invoice');
    });
  });

  describe('return credit note', () => {
    it('credits the returned units pro rata from the captured per-line tax, once per return', async () => {
      const shop = await setupShop('cn-return');
      const { order, invoice } = await invoicedOrder(shop, 4);
      const item = order.orderitem[0];
      const lineTax = await db.query<RowDataPacket[]>(
        `SELECT taxAmount FROM orderitem WHERE id = ?`,
        [item.id],
      );
      const lineTaxAmount = Number(lineTax[0].taxAmount);
      const returnId = await makeReturn(shop, order.id, item.id, 1);

      const cn = body<CreditNoteRow>(
        await issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId }).expect(201),
      );
      expect(cn.returnId).toBe(returnId);
      expect(Number(cn.subtotal)).toBe(100);
      expect(lineTaxAmount).toBeCloseTo(20, 2); // 400 gross at 5%
      expect(Number(cn.taxAmount)).toBeCloseTo(lineTaxAmount / 4, 2);
      expect(Number(cn.total)).toBeCloseTo(105, 2);
      expect(Number(cn.total)).toBeLessThanOrEqual(Number(invoice.total));

      await issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId }).expect(409);
      // A full credit note after a partial one would double-credit.
      await issue(shop.adminToken, { orderId: order.id, reason: 'correction' }).expect(409);
    });

    it("another order's return id is a 404", async () => {
      const shop = await setupShop('cn-return-other');
      const a = await invoicedOrder(shop, 2);
      const b = await invoicedOrder(shop, 2);
      const returnOfB = await makeReturn(shop, b.order.id, b.order.orderitem[0].id, 1);
      await issue(shop.adminToken, { orderId: a.order.id, reason: 'return', returnId: returnOfB }).expect(404);
    });

    it('NULL captured tax is unknown: a return credit note is refused, a full one is issued from the invoice figures', async () => {
      const shop = await setupShop('cn-pre-capture');
      const { order, invoice } = await invoicedOrder(shop, 2, shop.outletId, true);
      const returnId = await makeReturn(shop, order.id, order.orderitem[0].id, 1);

      const refused = await issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId }).expect(400);
      expect(msg(refused)).toContain('predates per-line tax capture');
      // Nothing was inserted and no CN number was burned.
      const none = await db.query<RowDataPacket[]>(`SELECT id FROM creditnote WHERE orderId = ?`, [order.id]);
      expect(none).toHaveLength(0);

      const full = body<CreditNoteRow>(
        await issue(shop.adminToken, { orderId: order.id, reason: 'correction' }).expect(201),
      );
      expect(full.number).toBe('CN-0001');
      expect(Number(full.taxAmount)).toBe(Number(invoice.taxAmount));
      const html = await request(http()).get(`/credit-notes/${full.id}/pdf`).set(auth(shop.adminToken)).expect(200);
      expect(html.text).not.toContain('Tax summary');
    });
  });

  describe('invariants', () => {
    it('never changes an order, its items, payments, returns or the invoice', async () => {
      const shop = await setupShop('cn-docs-only');
      const { order, invoice } = await invoicedOrder(shop, 3);
      const returnId = await makeReturn(shop, order.id, order.orderitem[0].id, 1);
      const snapshot = async () => ({
        order: await db.query<RowDataPacket[]>(`SELECT * FROM \`order\` WHERE id = ?`, [order.id]),
        items: await db.query<RowDataPacket[]>(`SELECT * FROM orderitem WHERE orderId = ? ORDER BY id`, [order.id]),
        pay: await db.query<RowDataPacket[]>(`SELECT * FROM paymenttransaction WHERE orderId = ? ORDER BY id`, [order.id]),
        returns: await db.query<RowDataPacket[]>(`SELECT * FROM orderreturn WHERE orderId = ? ORDER BY id`, [order.id]),
        returnItems: await db.query<RowDataPacket[]>(
          `SELECT ri.* FROM orderreturnitem ri JOIN orderreturn r ON r.id = ri.orderReturnId WHERE r.orderId = ? ORDER BY ri.id`,
          [order.id],
        ),
        invoice: await db.query<RowDataPacket[]>(`SELECT * FROM invoice WHERE id = ?`, [invoice.id]),
      });
      const before = JSON.stringify(await snapshot());
      await issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId }).expect(201);
      expect(JSON.stringify(await snapshot())).toBe(before);
    });

    it('the sum of credit notes never exceeds the invoice total, and a rejected attempt burns no number', async () => {
      const shop = await setupShop('cn-cap');
      const { order, invoice } = await invoicedOrder(shop, 4);
      const itemId = order.orderitem[0].id;
      const r1 = await makeReturn(shop, order.id, itemId, 1);
      await db.execute(`UPDATE invoice SET total = 10 WHERE id = ?`, [invoice.id]);
      const res = await issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId: r1 }).expect(400);
      expect(msg(res)).toContain('exceed');
      await db.execute(`UPDATE invoice SET total = ? WHERE id = ?`, [invoice.total, invoice.id]);
      const ok = await issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId: r1 }).expect(201);
      expect(body<CreditNoteRow>(ok).number).toBe('CN-0001');
    });

    it('concurrent issues for one invoice cannot both squeeze under the cap', async () => {
      const shop = await setupShop('cn-race');
      const { order, invoice } = await invoicedOrder(shop, 4);
      const itemId = order.orderitem[0].id;
      const r1 = await makeReturn(shop, order.id, itemId, 1);
      const r2 = await makeReturn(shop, order.id, itemId, 1);
      // Room for exactly one return credit note (each is a bit over 100).
      await db.execute(`UPDATE invoice SET total = 150 WHERE id = ?`, [invoice.id]);

      const results = await Promise.all([
        issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId: r1 }),
        issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId: r2 }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 400]);

      const rows = await db.query<RowDataPacket[]>(
        `SELECT total, number FROM creditnote WHERE invoiceId = ?`,
        [invoice.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].number).toBe('CN-0001');
      expect(Number(rows[0].total)).toBeLessThanOrEqual(150);
    });

    it('concurrent issue for the same return yields one credit note', async () => {
      const shop = await setupShop('cn-race-same');
      const { order } = await invoicedOrder(shop, 4);
      const r1 = await makeReturn(shop, order.id, order.orderitem[0].id, 1);
      const results = await Promise.all([
        issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId: r1 }),
        issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId: r1 }),
        issue(shop.adminToken, { orderId: order.id, reason: 'return', returnId: r1 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    });

    it('prices a KWD invoice to three decimals', async () => {
      const shop = await setupShop('cn-kwd');
      await db.execute(`UPDATE shop SET currency = 'KWD' WHERE id = ?`, [shop.shopId]);
      const { order, invoice } = await invoicedOrder(shop, 2);
      expect(invoice.currency).toBe('KWD');
      const cn = body<CreditNoteRow>(
        await issue(shop.adminToken, { orderId: order.id, reason: 'correction' }).expect(201),
      );
      expect(cn.currency).toBe('KWD');
      const html = await request(http()).get(`/credit-notes/${cn.id}/pdf`).set(auth(shop.adminToken)).expect(200);
      expect(html.text).toMatch(/KWD \d+\.\d{3}/);
    });
  });

  describe('tenant isolation', () => {
    it("shop A cannot read, issue or render against shop B's order / credit note", async () => {
      const a = await setupShop('cn-iso-a');
      const b = await setupShop('cn-iso-b');
      const ob = await invoicedOrder(b, 2);
      const cnB = body<CreditNoteRow>(
        await issue(b.adminToken, { orderId: ob.order.id, reason: 'correction' }).expect(201),
      );

      await issue(a.adminToken, { orderId: ob.order.id, reason: 'correction' }).expect(404);
      await request(http()).get(`/credit-notes?orderId=${ob.order.id}`).set(auth(a.adminToken)).expect(404);
      const pdf = await request(http()).get(`/credit-notes/${cnB.id}/pdf`).set(auth(a.adminToken)).expect(404);
      expect(pdf.text).not.toContain(cnB.number);

      // A's own order + B's return id: the return is scoped by the order, so 404.
      const oa = await invoicedOrder(a, 2);
      const returnB = await makeReturn(b, ob.order.id, ob.order.orderitem[0].id, 1);
      await issue(a.adminToken, { orderId: oa.order.id, reason: 'return', returnId: returnB }).expect(404);

      // B's note is untouched and still renders for B.
      await request(http()).get(`/credit-notes/${cnB.id}/pdf`).set(auth(b.adminToken)).expect(200);
      await request(http()).post('/credit-notes').send({ orderId: ob.order.id, reason: 'correction' }).expect(401);
    });

    it('a branch user stays on their outlet, and a restricting branch role removes issuing but not reading', async () => {
      const shop = await setupShop('cn-branch');
      const outletB = body<IdRow>(
        await request(http()).post('/outlets').set(auth(shop.adminToken)).send({ name: `Outlet B ${runId}-${seq}` }).expect(201),
      ).id;
      await request(http())
        .patch(`/outlets/${outletB}`)
        .set(auth(shop.adminToken))
        .send({ active: true, pickupEnabled: true })
        .expect(200);

      const email = `cn-branch-${runId}-${seq++}@test.com`;
      const staff = body<IdRow>(
        await request(http())
          .post('/auth/branch-users')
          .set(auth(shop.adminToken))
          .send({ name: 'Branch A', email, password: 'password123', outletId: shop.outletId })
          .expect(201),
      );
      const branchToken = body<AuthResponse>(
        await request(http()).post('/auth/login').send({ email, password: 'password123' }).expect(201),
      ).accessToken;

      const orderOnB = await invoicedOrder(shop, 1, outletB);
      const cnOnB = body<CreditNoteRow>(
        await issue(shop.adminToken, { orderId: orderOnB.order.id, reason: 'correction' }).expect(201),
      );
      await issue(branchToken, { orderId: orderOnB.order.id, reason: 'correction' }).expect(404);
      await request(http()).get(`/credit-notes?orderId=${orderOnB.order.id}`).set(auth(branchToken)).expect(404);
      await request(http()).get(`/credit-notes/${cnOnB.id}/pdf`).set(auth(branchToken)).expect(404);

      // Own outlet works.
      const orderOnA = await invoicedOrder(shop, 1, shop.outletId);
      // Restrict this branch user to read-only at their outlet.
      const role = body<IdRow>(
        await request(http())
          .post('/shop/branch-roles')
          .set(auth(shop.adminToken))
          .send({ name: `CN read-only ${runId}-${seq++}`, permissions: ['orders.view'] })
          .expect(201),
      );
      await request(http())
        .post('/shop/branch-roles/assignments')
        .set(auth(shop.adminToken))
        .send({ userId: staff.id, outletId: shop.outletId, branchRoleId: role.id })
        .expect(201);
      await issue(branchToken, { orderId: orderOnA.order.id, reason: 'correction' }).expect(403);
      await request(http()).get(`/credit-notes?orderId=${orderOnA.order.id}`).set(auth(branchToken)).expect(200);

      // The admin issues; the read-only branch user can still render it.
      const cnOnA = body<CreditNoteRow>(
        await issue(shop.adminToken, { orderId: orderOnA.order.id, reason: 'correction' }).expect(201),
      );
      await request(http()).get(`/credit-notes/${cnOnA.id}/pdf`).set(auth(branchToken)).expect(200);
    });

    it('a viewer can read credit notes but never issue one', async () => {
      const shop = await setupShop('cn-viewer');
      const email = `cn-viewer-${runId}-${seq++}@test.com`;
      await request(http())
        .post('/auth/branch-users')
        .set(auth(shop.adminToken))
        .send({ name: 'Viewer', email, password: 'password123', role: 'viewer' })
        .expect(201);
      const viewerToken = body<AuthResponse>(
        await request(http()).post('/auth/login').send({ email, password: 'password123' }).expect(201),
      ).accessToken;
      const { order } = await invoicedOrder(shop, 1);
      await issue(viewerToken, { orderId: order.id, reason: 'correction' }).expect(403);
      await request(http()).get(`/credit-notes?orderId=${order.id}`).set(auth(viewerToken)).expect(200);
    });
  });
});
