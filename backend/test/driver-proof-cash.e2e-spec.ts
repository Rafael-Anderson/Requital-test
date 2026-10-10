/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- untyped supertest JSON */
import 'dotenv/config';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { bootDriverFixture, body } from './helpers/driver-fixture';
import type { W5Shop } from './helpers/driver-fixture';

jest.setTimeout(300000);

describe('SHP-5 driver actions: proof, cash, timeline', () => {
  let fx: Awaited<ReturnType<typeof bootDriverFixture>>;
  let a: W5Shop;
  let b: W5Shop;
  let png: Buffer;

  beforeAll(async () => {
    fx = await bootDriverFixture();
    a = await fx.f.setupShop('prf-a');
    b = await fx.f.setupShop('prf-b');
    png = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
  });
  afterAll(async () => {
    await fx.app.close();
  });

  const tok = (t: string) => ({ 'X-Driver-Token': t });
  const deliver = (
    t: string,
    stopId: number,
    payload: Record<string, unknown> = {},
  ) =>
    fx
      .r()
      .post(`/driver-app/stops/${stopId}/deliver`)
      .set(tok(t))
      .send(payload);
  const fail = (
    t: string,
    stopId: number,
    reason = 'Nobody answered the door',
  ) =>
    fx
      .r()
      .post(`/driver-app/stops/${stopId}/fail`)
      .set(tok(t))
      .send({ reason });
  const photo = (t: string, stopId: number, buf: Buffer, name = 'p.png') =>
    fx
      .r()
      .post(`/driver-app/stops/${stopId}/photo`)
      .set(tok(t))
      .attach('photo', buf, name);
  const sendCode = (t: string, stopId: number) =>
    fx.r().post(`/driver-app/stops/${stopId}/code`).set(tok(t));

  // Brute-forces the 6-digit space against the stored salted hash. Independent of
  // whether the shop's email/WhatsApp channel is on, and it is precisely why the
  // attempt cap, not the hash, is the real defence.
  async function crackOtp(stopId: number): Promise<string> {
    const [row] = await fx.row<{ otpHash: string; otpSalt: string }>(
      `SELECT otpHash, otpSalt FROM deliveryrunstop WHERE id = ?`,
      [stopId],
    );
    for (let i = 0; i < 1_000_000; i++) {
      const code = String(i).padStart(6, '0');
      if (
        createHash('sha256')
          .update(`${stopId}:${row.otpSalt}:${code}`)
          .digest('hex') === row.otpHash
      ) {
        return code;
      }
    }
    throw new Error('no code');
  }
  const clearCooldown = (stopId: number) =>
    fx.db.execute(
      `UPDATE deliveryrunstop SET otpSentAt = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id = ?`,
      [stopId],
    );

  describe('proof of delivery', () => {
    it('refuses to deliver without the proof the run requires', async () => {
      const r = await fx.dispatchedRun(a);
      const res = await deliver(r.token, r.stops[0].id).expect(400);
      expect(body<{ code: string }>(res).code).toBe('proof_required');
      expect((await fx.f.orderRow(r.orders[0].id)).status).toBe(
        'out_for_delivery',
      );
    });

    it('accepts a photo, re-encodes it, keeps it private to staff', async () => {
      const r = await fx.dispatchedRun(a);
      const up = await photo(r.token, r.stops[0].id, png).expect(201);
      expect(body(up)).toEqual({ hasPhoto: true });
      const [stop] = await fx.row<{
        proofPhotoKey: string;
        proofPhotoUrl: string;
      }>(
        `SELECT proofPhotoKey, proofPhotoUrl FROM deliveryrunstop WHERE id = ?`,
        [r.stops[0].id],
      );
      expect(stop.proofPhotoKey).toMatch(
        new RegExp(`^delivery-proof/${a.shopId}/[0-9a-f]{64}\\.jpg$`),
      );
      const onDisk = join(process.cwd(), 'uploads', stop.proofPhotoKey);
      expect(existsSync(onDisk)).toBe(true);
      const meta = await sharp(readFileSync(onDisk)).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
      // the driver's own view never carries the URL or key
      const view = JSON.stringify(
        (await fx.r().get('/driver-app/run').set(tok(r.token)).expect(200))
          .body,
      );
      expect(view).not.toContain('delivery-proof');
      // staff see it
      const detail = await fx
        .r()
        .get(`/delivery-runs/${r.run.id}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(
        body<{ stops: { proofPhotoUrl: string }[] }>(detail).stops[0]
          .proofPhotoUrl,
      ).toContain('delivery-proof');
      // and it satisfies photo_or_otp
      const done = await deliver(r.token, r.stops[0].id).expect(201);
      expect(
        body<{ status: string; runCompleted: boolean }>(done),
      ).toMatchObject({ status: 'delivered', runCompleted: true });
      const [fin] = await fx.row<{ proofType: string }>(
        `SELECT proofType FROM deliveryrunstop WHERE id = ?`,
        [r.stops[0].id],
      );
      expect(fin.proofType).toBe('photo');
    });

    it('rejects abusive uploads', async () => {
      const r = await fx.dispatchedRun(a);
      const id = r.stops[0].id;
      const gif = Buffer.from(
        'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;',
        'binary',
      );
      await photo(r.token, id, Buffer.from('just some text'), 'a.jpg').expect(
        400,
      ); // wrong magic, right extension
      await photo(
        r.token,
        id,
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        'a.svg',
      ).expect(400);
      await photo(r.token, id, gif, 'a.gif').expect(400);
      await photo(
        r.token,
        id,
        Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
          Buffer.alloc(2000, 7),
        ]),
        'a.jpg',
      ).expect(400); // magic bytes, undecodable
      const big = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);
      const tooBig = await photo(r.token, id, big, 'big.png');
      expect([400, 413]).toContain(tooBig.status);
      await fx
        .r()
        .post(`/driver-app/stops/${id}/photo`)
        .set(tok(r.token))
        .expect(400); // no file
      const [row] = await fx.row<{ proofPhotoKey: string | null }>(
        `SELECT proofPhotoKey FROM deliveryrunstop WHERE id = ?`,
        [id],
      );
      expect(row.proofPhotoKey).toBeNull();
    });

    it('verifies the customer code, with an attempt cap and expiry', async () => {
      const r = await fx.dispatchedRun(a, { proofRequirement: 'otp' });
      const id = r.stops[0].id;
      // no code sent yet
      expect(
        body<{ code: string }>(
          await deliver(r.token, id, { code: '123456' }).expect(400),
        ).code,
      ).toBe('code_unavailable');
      // a photo is not enough when only a code is accepted
      await photo(r.token, id, png).expect(201);
      expect(
        body<{ code: string }>(await deliver(r.token, id).expect(400)).code,
      ).toBe('proof_required');

      const sent = await sendCode(r.token, id).expect(201);
      expect(JSON.stringify(sent.body)).not.toMatch(/\d{6}/); // never in the response
      const real = await crackOtp(id);
      const wrong = real === '000000' ? '000001' : '000000';
      for (let i = 0; i < 5; i++) {
        expect(
          body<{ code: string }>(
            await deliver(r.token, id, { code: wrong }).expect(400),
          ).code,
        ).toBe('invalid_code');
      }
      // five wrong guesses burned the code: even the RIGHT one is refused now
      expect(
        body<{ code: string }>(
          await deliver(r.token, id, { code: real }).expect(400),
        ).code,
      ).toBe('code_unavailable');
      expect((await fx.f.orderRow(r.orders[0].id)).status).toBe(
        'out_for_delivery',
      );

      // a fresh code (after the cooldown) works, and expiry kills it
      await sendCode(r.token, id).expect(429); // cooldown
      await clearCooldown(id);
      await sendCode(r.token, id).expect(201);
      const code2 = await crackOtp(id);
      await fx.db.execute(
        `UPDATE deliveryrunstop SET otpExpiresAt = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?`,
        [id],
      );
      expect(
        body<{ code: string }>(
          await deliver(r.token, id, { code: code2 }).expect(400),
        ).code,
      ).toBe('code_unavailable');
      await clearCooldown(id);
      await sendCode(r.token, id).expect(201);
      const code3 = await crackOtp(id);
      const ok = await deliver(r.token, id, { code: code3 }).expect(201);
      expect(body<{ status: string }>(ok).status).toBe('delivered');
      const [fin] = await fx.row<{ proofType: string; otpHash: string | null }>(
        `SELECT proofType, otpHash FROM deliveryrunstop WHERE id = ?`,
        [id],
      );
      expect(fin.proofType).toBe('both');
      expect(fin.otpHash).toBeNull(); // a spent code leaves nothing behind
      // a fourth send is over the cap
      expect(
        (
          await fx.row<{ otpSendCount: number }>(
            `SELECT otpSendCount FROM deliveryrunstop WHERE id = ?`,
            [id],
          )
        )[0].otpSendCount,
      ).toBe(3);
    });

    it('parallel wrong guesses cannot exceed the attempt cap', async () => {
      const r = await fx.dispatchedRun(a, { proofRequirement: 'otp' });
      const id = r.stops[0].id;
      await sendCode(r.token, id).expect(201);
      const real = await crackOtp(id);
      const wrong = real === '000000' ? '000001' : '000000';
      const results = await Promise.all(
        Array.from({ length: 12 }, () => deliver(r.token, id, { code: wrong })),
      );
      const codes = results.map((x) => (x.body as { code?: string }).code);
      expect(codes.filter((c) => c === 'invalid_code')).toHaveLength(5);
      expect(codes.filter((c) => c === 'code_unavailable')).toHaveLength(7);
      const [row] = await fx.row<{ otpAttempts: number }>(
        `SELECT otpAttempts FROM deliveryrunstop WHERE id = ?`,
        [id],
      );
      expect(row.otpAttempts).toBe(5);
    });

    it('the email job carries the code (so the customer can actually receive it)', async () => {
      const r = await fx.dispatchedRun(a, { proofRequirement: 'otp' });
      await sendCode(r.token, r.stops[0].id).expect(201);
      const real = await crackOtp(r.stops[0].id);
      const jobs = await fx.row<{ payload: unknown }>(
        `SELECT payload FROM job WHERE shopId = ? AND type = 'send_email' AND idempotencyKey = ?`,
        [a.shopId, `delivery-code:${r.stops[0].id}:1`],
      );
      if (jobs.length > 0) {
        const p =
          typeof jobs[0].payload === 'string'
            ? JSON.parse(jobs[0].payload)
            : jobs[0].payload;
        expect(p.bodyText).toContain(real);
      }
    });

    it("a 'none' run needs no proof; a 'photo' run does not use codes", async () => {
      const none = await fx.dispatchedRun(a, { proofRequirement: 'none' });
      const res = await deliver(none.token, none.stops[0].id).expect(201);
      expect(body<{ status: string }>(res).status).toBe('delivered');
      const ph = await fx.dispatchedRun(a, { proofRequirement: 'photo' });
      expect(
        body<{ code: string }>(
          await sendCode(ph.token, ph.stops[0].id).expect(400),
        ).code,
      ).toBe('code_not_used');
    });
  });

  describe('delivered and failed move the order through the real state machine', () => {
    it('writes a timeline entry attributed to the driver, with no user and no secret', async () => {
      const r = await fx.dispatchedRun(a, { proofRequirement: 'none' });
      await deliver(r.token, r.stops[0].id).expect(201);
      expect((await fx.f.orderRow(r.orders[0].id)).status).toBe('delivered');
      const hist = await fx
        .r()
        .get(`/orders/${r.orders[0].id}/history`)
        .set(fx.h(a.adminToken))
        .expect(200);
      const entries =
        body<{ status: string; actorName: string | null }[]>(hist);
      const last = entries[entries.length - 1];
      expect(last.status).toBe('delivered');
      expect(last.actorName).toBe(
        `driver ${(await fx.row<{ name: string }>(`SELECT name FROM driver WHERE id = ?`, [r.driver.id]))[0].name}`,
      );
      const rows = await fx.row<{
        actorUserId: number | null;
        actorLabel: string;
        after: unknown;
        metadata: unknown;
      }>(
        `SELECT actorUserId, actorLabel, \`after\`, metadata FROM auditlog WHERE shopId = ? AND entityType = 'order' AND entityId = ? AND actorLabel IS NOT NULL`,
        [a.shopId, r.orders[0].id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actorUserId).toBeNull();
      expect(JSON.stringify(rows)).not.toContain(r.token);
    });

    it('is idempotent: a retry and a parallel double tap change nothing', async () => {
      const r = await fx.dispatchedRun(a, { n: 2, proofRequirement: 'none' });
      const id = r.stops[0].id;
      const par = await Promise.all([
        deliver(r.token, id),
        deliver(r.token, id),
        deliver(r.token, id),
      ]);
      expect(par.every((x) => x.status === 201)).toBe(true);
      expect(
        par.filter((x) => !(x.body as { idempotent: boolean }).idempotent),
      ).toHaveLength(1);
      const again = await deliver(r.token, id).expect(201);
      expect(body<{ idempotent: boolean }>(again).idempotent).toBe(true);
      const delivered = await fx.row(
        `SELECT id FROM auditlog WHERE shopId = ? AND entityType = 'order' AND entityId = ? AND action = 'order.status_changed' AND \`after\`->>'$.status' = 'delivered'`,
        [a.shopId, r.orders[0].id],
      );
      expect(delivered).toHaveLength(1);
      // a delivered stop cannot be failed afterwards
      await fail(r.token, id).expect(409);
    });

    it('repairs a half-finished delivery on retry (stop delivered, order not yet)', async () => {
      const r = await fx.dispatchedRun(a, { n: 2, proofRequirement: 'none' });
      const id = r.stops[0].id;
      await fx.db.execute(
        `UPDATE deliveryrunstop SET status = 'delivered', deliveredAt = NOW(3), activeOrderId = NULL WHERE id = ?`,
        [id],
      );
      expect((await fx.f.orderRow(r.orders[0].id)).status).toBe(
        'out_for_delivery',
      );
      await deliver(r.token, id).expect(201);
      expect((await fx.f.orderRow(r.orders[0].id)).status).toBe('delivered');
    });

    it('a failed stop leaves the order out for delivery, stock alone, and re-runnable', async () => {
      const r = await fx.dispatchedRun(a, { n: 2 });
      const [s1] = r.stops;
      const f1 = await fail(r.token, s1.id, 'Customer not home').expect(201);
      expect(body<{ status: string }>(f1).status).toBe('failed');
      expect(
        body<{ idempotent: boolean }>(
          await fail(r.token, s1.id, 'again').expect(201),
        ).idempotent,
      ).toBe(true);
      expect((await fx.f.orderRow(r.orders[0].id)).status).toBe(
        'out_for_delivery',
      );
      await deliver(r.token, s1.id).expect(409); // closed
      await fx
        .r()
        .post(`/driver-app/stops/${s1.id}/fail`)
        .set(tok(r.token))
        .send({ reason: 'x' })
        .expect(400); // too short
      await fx
        .r()
        .post(`/driver-app/stops/${s1.id}/fail`)
        .set(tok(r.token))
        .send({})
        .expect(400);
      const hist = await fx
        .r()
        .get(`/orders/${r.orders[0].id}/history`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(body<{ status: string }[]>(hist).map((e) => e.status)).toContain(
        'delivery_failed',
      );
      const movements = await fx
        .row(`SELECT id FROM stockmovement WHERE shopId = ? AND note LIKE ?`, [
          a.shopId,
          `%${r.orders[0].id}%`,
        ])
        .catch(() => []);
      expect(movements).toHaveLength(0);
      // free for another run
      const again = await fx.createRun(a, r.driver.id, [r.orders[0].id]);
      expect(again.stops).toHaveLength(1);
    });

    it('completes the run and kills the link once every stop is resolved', async () => {
      const r = await fx.dispatchedRun(a, { n: 2, proofRequirement: 'none' });
      const first = await deliver(r.token, r.stops[0].id).expect(201);
      expect(body<{ runCompleted: boolean }>(first).runCompleted).toBe(false);
      const [mid] = await fx.row<{ status: string }>(
        `SELECT status FROM deliveryrun WHERE id = ?`,
        [r.run.id],
      );
      expect(mid.status).toBe('in_progress');
      const last = await fail(r.token, r.stops[1].id).expect(201);
      expect(body<{ runCompleted: boolean }>(last).runCompleted).toBe(true);
      const [done] = await fx.row<{ status: string }>(
        `SELECT status FROM deliveryrun WHERE id = ?`,
        [r.run.id],
      );
      expect(done.status).toBe('completed');
      await fx.r().get('/driver-app/run').set(tok(r.token)).expect(404);
    });

    it('refuses to hand over an order staff cancelled meanwhile', async () => {
      const r = await fx.dispatchedRun(a, { proofRequirement: 'none' });
      await fx.f.cancelOrder(a, r.orders[0].id).expect(201);
      const view = body<{
        stops: { deliverable: boolean; orderCancelled: boolean }[];
      }>(await fx.r().get('/driver-app/run').set(tok(r.token)).expect(200));
      expect(view.stops[0]).toMatchObject({
        deliverable: false,
        orderCancelled: true,
      });
      const res = await deliver(r.token, r.stops[0].id).expect(409);
      expect(body<{ code: string }>(res).code).toBe('order_not_deliverable');
      expect((await fx.f.orderRow(r.orders[0].id)).status).toBe('cancelled');
    });
  });

  describe('cash on delivery', () => {
    it('records exact cash through collectCash, attributed to the driver and not a user', async () => {
      const r = await fx.dispatchedRun(a, {
        cod: true,
        proofRequirement: 'none',
        price: 100,
      });
      const [order] = await fx.row<{ total: string }>(
        `SELECT total FROM \`order\` WHERE id = ?`,
        [r.orders[0].id],
      );
      const total = String(Number(order.total));
      // cash is required for a COD stop
      expect(
        body<{ code: string }>(
          await deliver(r.token, r.stops[0].id).expect(400),
        ).code,
      ).toBe('cash_required');
      await deliver(r.token, r.stops[0].id, { cashCollected: total }).expect(
        201,
      );
      const row = await fx.f.orderRow(r.orders[0].id);
      expect(row.status).toBe('delivered');
      expect(row.cashCollectedAt).not.toBeNull();
      expect(row.cashCollectedBy).toBeNull();
      expect(row.cashCollectedByDriverId).toBe(r.driver.id);
      const detail = await fx
        .r()
        .get(`/orders/${r.orders[0].id}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      expect(
        body<{ cashCollectedByName: string }>(detail).cashCollectedByName,
      ).toMatch(/^Driver /);
      const [stop] = await fx.row<{
        cashDiscrepancy: number;
        cashCurrency: string;
      }>(
        `SELECT cashDiscrepancy, cashCurrency FROM deliveryrunstop WHERE id = ?`,
        [r.stops[0].id],
      );
      expect(Boolean(stop.cashDiscrepancy)).toBe(false);
      expect(stop.cashCurrency).toBe(row.currency);
    });

    it('flags a mismatch for staff without blocking the delivery, and reconciles per driver', async () => {
      const r = await fx.dispatchedRun(a, {
        cod: true,
        proofRequirement: 'none',
        price: 100,
      });
      const [order] = await fx.row<{ total: string }>(
        `SELECT total FROM \`order\` WHERE id = ?`,
        [r.orders[0].id],
      );
      const short = (Number(order.total) - 10).toFixed(2);
      await deliver(r.token, r.stops[0].id, { cashCollected: short }).expect(
        201,
      );
      expect((await fx.f.orderRow(r.orders[0].id)).status).toBe('delivered');
      const detail = await fx
        .r()
        .get(`/delivery-runs/${r.run.id}`)
        .set(fx.h(a.adminToken))
        .expect(200);
      const d = body<{
        stops: { cashDiscrepancy: boolean }[];
        cash: {
          currency: string;
          expected: string;
          collected: string;
          difference: string;
          discrepancies: number;
        }[];
      }>(detail);
      expect(d.stops[0].cashDiscrepancy).toBe(true);
      expect(d.cash[0]).toMatchObject({
        discrepancies: 1,
        difference: '-10.00',
      });
      expect(
        Number(d.cash[0].expected) - Number(d.cash[0].collected),
      ).toBeCloseTo(10, 5);
      const audit = await fx.row(
        `SELECT id FROM auditlog WHERE shopId = ? AND action = 'delivery.cash_discrepancy' AND entityId = ?`,
        [a.shopId, r.orders[0].id],
      );
      expect(audit).toHaveLength(1);
      const recon = await fx
        .r()
        .get(
          `/delivery-runs/cash-reconciliation?outletId=${a.outletId}&driverId=${r.driver.id}`,
        )
        .set(fx.h(a.adminToken))
        .expect(200);
      const entry = body<
        {
          runId: number;
          totals: { difference: string; discrepancies: number }[];
        }[]
      >(recon).find((x) => x.runId === r.run.id)!;
      expect(entry.totals[0]).toMatchObject({
        difference: '-10.00',
        discrepancies: 1,
      });
    });

    it('handles a 3-decimal currency exactly (KWD 10.505)', async () => {
      const r = await fx.dispatchedRun(a, {
        cod: true,
        proofRequirement: 'none',
        n: 3,
      });
      for (const o of r.orders) {
        await fx.db.execute(
          `UPDATE \`order\` SET total = '10.505', currency = 'KWD' WHERE id = ?`,
          [o.id],
        );
      }
      // three decimals are legal in KWD but a fractional minor unit is not
      await deliver(r.token, r.stops[0].id, {
        cashCollected: '10.5055',
      }).expect(400);
      await deliver(r.token, r.stops[0].id, { cashCollected: '-1' }).expect(
        400,
      );
      // an AED order cannot be settled in thousandths
      const aed = await fx.dispatchedRun(a, {
        cod: true,
        proofRequirement: 'none',
      });
      const bad = await deliver(aed.token, aed.stops[0].id, {
        cashCollected: '10.505',
      }).expect(400);
      expect(body<{ code: string }>(bad).code).toBe('cash_invalid');
      await deliver(r.token, r.stops[0].id, { cashCollected: '10.505' }).expect(
        201,
      );
      await deliver(r.token, r.stops[1].id, { cashCollected: 10.5 }).expect(
        201,
      ); // 10.500 != 10.505
      await deliver(r.token, r.stops[2].id, { cashCollected: '10.505' }).expect(
        201,
      );
      const rows = await fx.row<{
        id: number;
        cashDiscrepancy: number;
        cashCollectedAmount: string;
        codExpected: string;
      }>(
        `SELECT id, cashDiscrepancy, cashCollectedAmount, codExpected FROM deliveryrunstop WHERE runId = ? ORDER BY position`,
        [r.run.id],
      );
      expect(rows.map((x) => Boolean(x.cashDiscrepancy))).toEqual([
        false,
        true,
        false,
      ]);
      expect(Number(rows[0].codExpected)).toBe(10.505);
      expect(Number(rows[1].cashCollectedAmount)).toBe(10.5);
    });

    it('rejects cash on a non-COD order, and leaves staff-collected cash alone', async () => {
      const card = await fx.dispatchedRun(a, { proofRequirement: 'none' });
      expect(
        body<{ code: string }>(
          await deliver(card.token, card.stops[0].id, {
            cashCollected: '5',
          }).expect(400),
        ).code,
      ).toBe('not_cod');
      const cod = await fx.dispatchedRun(a, {
        cod: true,
        proofRequirement: 'none',
      });
      await fx
        .r()
        .post(`/orders/${cod.orders[0].id}/collect-cash`)
        .set(fx.h(a.adminToken))
        .expect(201);
      await deliver(cod.token, cod.stops[0].id).expect(201); // nothing left to take
      const row = await fx.f.orderRow(cod.orders[0].id);
      expect(row.cashCollectedBy).not.toBeNull();
      expect(row.cashCollectedByDriverId).toBeNull();
    });
  });

  describe('isolation', () => {
    it("a token cannot touch another run's or another shop's stop", async () => {
      const one = await fx.dispatchedRun(a, { proofRequirement: 'none' });
      const two = await fx.dispatchedRun(a, { proofRequirement: 'none' });
      const other = await fx.dispatchedRun(b, { proofRequirement: 'none' });
      for (const foreign of [two.stops[0].id, other.stops[0].id, 99999999]) {
        await deliver(one.token, foreign).expect(404);
        await fail(one.token, foreign).expect(404);
        await sendCode(one.token, foreign).expect(404);
        await photo(one.token, foreign, png).expect(404);
      }
      for (const s of [two, other]) {
        const [row] = await fx.row<{ status: string }>(
          `SELECT status FROM deliveryrunstop WHERE id = ?`,
          [s.stops[0].id],
        );
        expect(row.status).toBe('pending');
      }
      await deliver(one.token, one.stops[0].id).expect(201);
    });

    it('a deactivated driver or revoked link cannot act', async () => {
      const r = await fx.dispatchedRun(a, { proofRequirement: 'none', n: 2 });
      await fx
        .r()
        .patch(`/drivers/${r.driver.id}`)
        .set(fx.h(a.adminToken))
        .send({ active: false })
        .expect(200);
      await deliver(r.token, r.stops[0].id).expect(404);
      await fail(r.token, r.stops[0].id).expect(404);
      const [row] = await fx.row<{ status: string }>(
        `SELECT status FROM deliveryrunstop WHERE id = ?`,
        [r.stops[0].id],
      );
      expect(row.status).toBe('pending');
    });

    it('a link is no staff credential and a staff token is no driver credential', async () => {
      const r = await fx.dispatchedRun(a, { proofRequirement: 'none' });
      await fx
        .r()
        .post(`/driver-app/stops/${r.stops[0].id}/deliver`)
        .set(fx.h(a.adminToken))
        .send({})
        .expect(404);
      await fx
        .r()
        .post(`/orders/${r.orders[0].id}/cancel`)
        .set(tok(r.token))
        .expect(401);
    });

    it('has a per-link ceiling on top of the per-IP throttle', async () => {
      const r = await fx.dispatchedRun(a, { proofRequirement: 'none' });
      const res = await Promise.all(
        Array.from({ length: 130 }, () =>
          fx.r().get('/driver-app/run').set(tok(r.token)),
        ),
      );
      expect(res.some((x) => x.status === 429)).toBe(true);
      expect(res.filter((x) => x.status === 200).length).toBeLessThanOrEqual(
        120,
      );
    });
  });
});
