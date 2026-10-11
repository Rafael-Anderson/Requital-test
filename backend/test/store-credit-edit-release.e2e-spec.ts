import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { PaymentsService } from '../src/payments/payments.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';
import {
  asCustomer,
  registerCustomer,
  type CustomerSession,
} from './helpers/customer-session';

jest.setTimeout(240000);

// W3. Editing an order that spent store credit / a gift card, and every reader of
// "what is still due". Each test fails on the pre-W3 code: updateItems and
// updateDeliveryFee left order.storeCreditAmount / giftCardAmount alone, so the
// order held more credit than it cost and cancel reversed the ORIGINAL spend.
describe('Store credit and gift card on an edited order (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let seq = 0;
  const phone = () =>
    `05${String(Date.now() % 100000)}${String(++seq).padStart(3, '0')}`;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
  });
  afterAll(async () => {
    await app.close();
  });

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  const admin = (
    shop: Shop,
    method: 'get' | 'post',
    path: string,
    data?: object,
  ) =>
    request(server())
      [method](path)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send(data);

  async function setup(
    prefix: string,
    opts: { currency?: string; price?: number; cheap?: number } = {},
  ) {
    const shop = await f.setupShop(prefix);
    if (opts.currency) await f.setShop(shop, { currency: opts.currency });
    const product = await f.stockedProduct(shop, 100, {
      price: opts.price ?? 100,
    });
    const cheap = await f.stockedProduct(shop, 100, {
      price: opts.cheap ?? 10,
    });
    await f.publish(shop);
    const customer = await registerCustomer(
      server(),
      shop.slug,
      phone(),
      `sce-${f.uniq()}@x.test`,
    );
    return { shop, product, cheap, customer };
  }

  const grant = (
    shop: Shop,
    customerId: number,
    amount: number | string,
    currency = 'AED',
  ) =>
    admin(shop, 'post', `/customers/${customerId}/store-credit/adjustments`, {
      currency,
      amount,
      direction: 'grant',
      reason: 'goodwill',
    }).expect(201);

  function checkout(
    shop: Shop,
    sess: CustomerSession,
    productId: number,
    extra: Record<string, unknown> = {},
    qty = 1,
  ) {
    return asCustomer(
      server(),
      sess,
      'post',
      `/public/${shop.slug}/orders`,
    ).send({
      outletId: shop.outletId,
      orderType: 'pickup',
      paymentMethod: 'cash_on_pickup',
      customerName: 'Edit Customer',
      customerPhone: phone(),
      customerAddress: 'Pickup',
      items: [{ productId, quantity: qty }],
      ...extra,
    });
  }
  const orderId = (res: request.Response) =>
    body<{ order: { id: number } }>(res).order.id;

  const sumCustomer = async (customerId: number, currency = 'AED') =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(amount), 0) AS s FROM storecreditentry WHERE customerId = ? AND currency = ?`,
          [customerId, currency],
        )
      )[0].s,
    );
  // What the ledger says one order currently holds: the negated sum of every
  // entry that carries its orderId (spend, spend_release, spend_reversal).
  const heldInLedger = async (id: number) =>
    -Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(amount), 0) AS s FROM storecreditentry WHERE orderId = ?`,
          [id],
        )
      )[0].s,
    );
  const entriesOf = (id: number) =>
    db.query<RowDataPacket[]>(
      `SELECT entryType, amount, editSeq FROM storecreditentry WHERE orderId = ? ORDER BY id`,
      [id],
    );
  const edit = (shop: Shop, id: number, productId: number, quantity: number) =>
    f.editItems(shop, id, [{ productId, quantity }]);

  it('an edit-down gives the excess credit back, once per edit, and cancel reverses only what is still held', async () => {
    const { shop, product, cheap, customer } = await setup('sce-down');
    await grant(shop, customer.customerId, 1000);
    const id = orderId(
      await checkout(
        shop,
        customer,
        product.id,
        { useStoreCredit: true },
        2,
      ).expect(201),
    );
    const t0 = Number((await f.orderRow(id)).total);
    expect(Number((await f.orderRow(id)).storeCreditAmount)).toBe(t0);
    expect(await sumCustomer(customer.customerId)).toBeCloseTo(1000 - t0, 6);

    await edit(shop, id, product.id, 1).expect(200);
    const row1 = await f.orderRow(id);
    const t1 = Number(row1.total);
    expect(t1).toBeLessThan(t0);
    expect(Number(row1.storeCreditAmount)).toBeCloseTo(t1, 6);
    expect(await sumCustomer(customer.customerId)).toBeCloseTo(1000 - t1, 6);
    expect(await heldInLedger(id)).toBeCloseTo(t1, 6);

    // The same edit again (a retry): nothing in excess, nothing written.
    const before = (await entriesOf(id)).length;
    await edit(shop, id, product.id, 1).expect(200);
    expect(await entriesOf(id)).toHaveLength(before);

    await edit(shop, id, cheap.id, 1).expect(200);
    const row2 = await f.orderRow(id);
    const t2 = Number(row2.total);
    expect(Number(row2.storeCreditAmount)).toBeCloseTo(t2, 6);
    const kinds = (await entriesOf(id)).map((e) => [
      String(e.entryType),
      Number(e.editSeq),
    ]);
    expect(kinds).toEqual([
      ['spend', 0],
      ['spend_release', 1],
      ['spend_release', 2],
    ]);
    expect(await heldInLedger(id)).toBeCloseTo(t2, 6);

    // Cancel reverses what is held NOW, not the original spend: the balance ends
    // exactly where it began, not 'original spend' too high.
    await f.cancelOrder(shop, id).expect(201);
    expect(await sumCustomer(customer.customerId)).toBeCloseTo(1000, 6);
    expect(await heldInLedger(id)).toBeCloseTo(0, 6);
    const last = (await entriesOf(id)).map((e) => String(e.entryType));
    expect(last).toEqual([
      'spend',
      'spend_release',
      'spend_release',
      'spend_reversal',
    ]);
  });

  it('an edit-up never spends more credit: the extra is simply still to pay', async () => {
    const { shop, product, customer } = await setup('sce-up');
    await grant(shop, customer.customerId, 1000);
    const id = orderId(
      await checkout(shop, customer, product.id, {
        useStoreCredit: true,
      }).expect(201),
    );
    const before = await f.orderRow(id);
    const entries = (await entriesOf(id)).length;
    const bal = await sumCustomer(customer.customerId);
    await edit(shop, id, product.id, 3).expect(200);
    const after = await f.orderRow(id);
    expect(Number(after.total)).toBeGreaterThan(Number(before.total));
    expect(Number(after.storeCreditAmount)).toBe(
      Number(before.storeCreditAmount),
    );
    expect(await entriesOf(id)).toHaveLength(entries);
    expect(await sumCustomer(customer.customerId)).toBe(bal);
    // cancel gives back exactly the original (== still held) amount
    await f.cancelOrder(shop, id).expect(201);
    expect(await sumCustomer(customer.customerId)).toBeCloseTo(1000, 6);
  });

  it('releases store credit first, then the gift card, and the card balance and redemption follow', async () => {
    const { shop, product, cheap, customer } = await setup('sce-gift');
    await grant(shop, customer.customerId, 1000);
    const card = body<{ code: string; id: number }>(
      await admin(shop, 'post', '/gift-cards', { initialValue: 60 }).expect(
        201,
      ),
    );
    const id = orderId(
      await checkout(
        shop,
        customer,
        product.id,
        { useStoreCredit: true, giftCardCode: card.code },
        2,
      ).expect(201),
    );
    const r0 = await f.orderRow(id);
    const t0 = Number(r0.total);
    expect(Number(r0.giftCardAmount)).toBe(60);
    expect(Number(r0.storeCreditAmount)).toBeCloseTo(t0 - 60, 6);

    // New total (about 10) is below the 60 gift card alone: ALL credit and part
    // of the gift card go back.
    await edit(shop, id, cheap.id, 1).expect(200);
    const r1 = await f.orderRow(id);
    const t1 = Number(r1.total);
    expect(t1).toBeLessThan(60);
    expect(Number(r1.storeCreditAmount)).toBe(0);
    expect(Number(r1.giftCardAmount)).toBeCloseTo(t1, 6);
    expect(await sumCustomer(customer.customerId)).toBeCloseTo(1000, 6);
    const cardRow = (
      await db.query<RowDataPacket[]>(
        `SELECT remainingBalance FROM giftcard WHERE id = ?`,
        [card.id],
      )
    )[0];
    expect(Number(cardRow.remainingBalance)).toBeCloseTo(60 - t1, 6);
    const red = (
      await db.query<RowDataPacket[]>(
        `SELECT amountUsed FROM giftcardredemption WHERE giftCardId = ? AND orderId = ?`,
        [card.id, id],
      )
    )[0];
    expect(Number(red.amountUsed)).toBeCloseTo(t1, 6);
    // order.total - gift - credit is exactly 0 due
    expect(
      t1 - Number(r1.giftCardAmount) - Number(r1.storeCreditAmount),
    ).toBeCloseTo(0, 6);
  });

  it('a delivery-fee decrease releases the excess credit as well', async () => {
    const { shop, product, customer } = await setup('sce-fee');
    await grant(shop, customer.customerId, 1000);
    const id = orderId(
      await checkout(shop, customer, product.id, {
        useStoreCredit: true,
      }).expect(201),
    );
    const t = Number((await f.orderRow(id)).total);
    // Simulate an order that was placed with a 50 delivery fee fully paid by credit.
    await db.execute(
      `UPDATE \`order\` SET deliveryFee = 50, total = ?, storeCreditAmount = ? WHERE id = ?`,
      [t + 50, t + 50, id],
    );
    await db.execute(
      `UPDATE storecreditentry SET amount = ? WHERE orderId = ? AND entryType = 'spend'`,
      [-(t + 50), id],
    );
    await request(server())
      .patch(`/orders/${id}/delivery-fee`)
      .set(f.auth(shop))
      .send({ deliveryFee: 0 })
      .expect(200);
    const row = await f.orderRow(id);
    expect(Number(row.total)).toBeCloseTo(t, 6);
    expect(Number(row.storeCreditAmount)).toBeCloseTo(t, 6);
    expect(await heldInLedger(id)).toBeCloseTo(t, 6);
    expect((await entriesOf(id)).map((e) => String(e.entryType))).toEqual([
      'spend',
      'spend_release',
    ]);
  });

  it('KWD: the release is exact to the third decimal', async () => {
    const { shop, product, customer } = await setup('sce-kwd', {
      currency: 'KWD',
      price: 10.505,
      cheap: 1.001,
    });
    await grant(shop, customer.customerId, 500, 'KWD');
    const id = orderId(
      await checkout(
        shop,
        customer,
        product.id,
        { useStoreCredit: true },
        3,
      ).expect(201),
    );
    const t0 = Math.round(Number((await f.orderRow(id)).total) * 1000);
    await edit(shop, id, product.id, 1).expect(200);
    const row = await f.orderRow(id);
    const t1 = Math.round(Number(row.total) * 1000);
    expect(Math.round(Number(row.storeCreditAmount) * 1000)).toBe(t1);
    const bal = Math.round(
      (await sumCustomer(customer.customerId, 'KWD')) * 1000,
    );
    expect(bal).toBe(500000 - t1);
    const rel = (await entriesOf(id)).find(
      (e) => e.entryType === 'spend_release',
    )!;
    expect(Math.round(Number(rel.amount) * 1000)).toBe(t0 - t1);
  });

  it('CONCURRENCY: parallel edits and a cancel keep the ledger equal to what the order holds', async () => {
    const { shop, product, cheap, customer } = await setup('sce-race');
    await grant(shop, customer.customerId, 1000);
    const id = orderId(
      await checkout(
        shop,
        customer,
        product.id,
        { useStoreCredit: true },
        3,
      ).expect(201),
    );
    const results = await Promise.all([
      edit(shop, id, product.id, 2),
      edit(shop, id, cheap.id, 1),
      edit(shop, id, product.id, 1),
      f.cancelOrder(shop, id),
    ]);
    for (const r of results) expect([200, 201, 400, 409]).toContain(r.status);
    const row = await f.orderRow(id);
    const held = await heldInLedger(id);
    if (row.status === 'cancelled') {
      expect(held).toBeCloseTo(0, 6);
      expect(await sumCustomer(customer.customerId)).toBeCloseTo(1000, 6);
    } else {
      expect(held).toBeCloseTo(Number(row.storeCreditAmount), 6);
      expect(await sumCustomer(customer.customerId)).toBeCloseTo(
        1000 - Number(row.storeCreditAmount),
        6,
      );
    }
    expect(Number(row.storeCreditAmount)).toBeLessThanOrEqual(
      Number(row.total) + 1e-9,
    );
    // editSeq values are unique per order by construction
    const seqs = (await entriesOf(id))
      .filter((e) => e.entryType === 'spend_release')
      .map((e) => Number(e.editSeq));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  describe('what is due (total - gift card - store credit)', () => {
    async function codOrder(prefix: string, price = 100) {
      const s = await setup(prefix, { price });
      await grant(s.shop, s.customer.customerId, 30);
      const card = body<{ code: string }>(
        await admin(s.shop, 'post', '/gift-cards', { initialValue: 20 }).expect(
          201,
        ),
      );
      const id = orderId(
        await checkout(s.shop, s.customer, s.product.id, {
          useStoreCredit: true,
          giftCardCode: card.code,
        }).expect(201),
      );
      await db.execute(
        `UPDATE \`order\` SET paymentMethod = 'cash_on_delivery', paymentStatus = 'unpaid' WHERE id = ?`,
        [id],
      );
      const row = await f.orderRow(id);
      const due = Number(row.total) - 20 - 30;
      expect(due).toBeGreaterThan(0);
      return { ...s, id, row, due };
    }

    it('the packing slip says CASH TO COLLECT the amount due, not the total', async () => {
      const { shop, id, row, due } = await codOrder('sce-slip');
      const slip = body<{ id: number }>(
        await admin(shop, 'post', '/invoices', {
          orderId: id,
          type: 'PACKING_SLIP',
        }).expect(201),
      );
      const html = (
        await request(server())
          .get(`/invoices/${slip.id}/pdf`)
          .set(f.auth(shop))
          .expect(200)
      ).text;
      expect(html).toContain(`CASH TO COLLECT: AED ${due.toFixed(2)}`);
      expect(html).not.toContain(
        `CASH TO COLLECT: AED ${Number(row.total).toFixed(2)}`,
      );
    });

    it('the webhook transaction row records the amount charged (due), not the order total', async () => {
      const { id, due, row } = await codOrder('sce-hook');
      const payments = app.get(PaymentsService);
      await payments.applyWebhookResult('stripe', 'stripe', {
        providerReference: `evt_w3_${id}`,
        orderId: id,
        status: 'paid',
        chargeReference: `pi_w3_${id}`,
      });
      const tx = (
        await db.query<RowDataPacket[]>(
          `SELECT amount, currency FROM paymenttransaction WHERE orderId = ?`,
          [id],
        )
      )[0];
      expect(Number(tx.amount)).toBeCloseTo(due, 6);
      expect(Number(tx.amount)).toBeLessThan(Number(row.total));
      expect(tx.currency).toBe('AED');
    });
  });
});
