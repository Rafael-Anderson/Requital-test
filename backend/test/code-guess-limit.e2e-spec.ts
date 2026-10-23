import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { DatabaseService } from '../src/database/database.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';

jest.setTimeout(120000);

// F3: discount and gift-card codes could be guessed. Each public handler had
// its own per-IP bucket (20 + 20 + 40 a minute across validate, order and
// quote), and the answer told a guesser whether a code existed (not found vs
// inactive vs expired vs not started). One failed-attempt budget now covers
// all four surfaces and the answer is the same generic one until existence is
// proven. THROTTLE_IN_TESTS=1 switches the limiter on (it is off under Jest
// like the Throttler); shops are created BEFORE it is flipped so signup's own
// 5-a-minute limit does not interfere.
describe('Code guess limiter (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  const previous = process.env.THROTTLE_IN_TESTS;

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  type World = {
    shop: Shop;
    productId: number;
    valid: string;
    inactive: string;
    expired: string;
    future: string;
    minPurchase: string;
  };
  let s1: World, s2: World, s3: World, s4: World, s5: World, s6: World;

  async function world(prefix: string): Promise<World> {
    const shop = await f.setupShop(prefix);
    const p = await f.stockedProduct(shop, 100, { price: 20 });
    await f.publish(shop);
    const d = async (o: Record<string, unknown>) =>
      (await f.createDiscount(shop, o)).code!;
    return {
      shop,
      productId: p.id,
      valid: await d({ value: 10 }),
      inactive: await d({ active: false }),
      expired: await d({ endsAt: '2020-01-01T00:00:00.000Z' }),
      future: await d({ startsAt: '2099-01-01T00:00:00.000Z' }),
      minPurchase: await d({ minPurchaseAmount: 100000 }),
    };
  }

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
    s1 = await world('cg1');
    s2 = await world('cg2');
    s3 = await world('cg3');
    s4 = await world('cg4');
    s5 = await world('cg5');
    s6 = await world('cg6');
    // listening once, so 20 parallel supertest calls share one server instead of
    // each opening (and closing) its own
    await app.listen(0);
    process.env.THROTTLE_IN_TESTS = '1';
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.THROTTLE_IN_TESTS;
    else process.env.THROTTLE_IN_TESTS = previous;
    await app.close();
  });

  const items = (w: World) => [{ productId: w.productId, quantity: 1 }];
  const validate = (w: World, code: string) =>
    request(f.http())
      .post(`/public/${w.shop.slug}/discounts/validate`)
      .send({ code, cartSubtotal: 0, items: items(w) });
  const quote = (w: World, discountCode: string) =>
    request(f.http())
      .post(`/public/${w.shop.slug}/delivery-quote`)
      .send({
        outletId: w.shop.outletId,
        orderType: 'pickup',
        items: items(w),
        discountCode,
      });
  const order = (w: World, discountCode: string) =>
    f.storefrontOrderRaw(w.shop, items(w), { discountCode });
  const giftValidate = (w: World, code: string) =>
    request(f.http())
      .post(`/public/${w.shop.slug}/gift-cards/validate`)
      .send({ code });
  const msg = (res: { body: unknown }) =>
    (res.body as { message?: string }).message;

  it('unknown, inactive, expired and not-started codes get one identical answer', async () => {
    const answers: Record<string, unknown>[] = [];
    for (const code of ['NOSUCHCODE1', s1.inactive, s1.expired, s1.future]) {
      const res = await validate(s1, code);
      expect(res.status).toBe(201);
      answers.push(body<Record<string, unknown>>(res));
    }
    for (const a of answers) {
      expect(a).toEqual(answers[0]);
      expect(a.valid).toBe(false);
      expect(a.message).toBe('This code is not valid or cannot be applied');
    }
  });

  it('a rejection that needs the code to exist stays specific, and staff keep the specific wording', async () => {
    const res = await validate(s1, s1.minPurchase);
    expect(body<{ message: string }>(res).message).toMatch(/minimum purchase/);
    const admin = await request(f.http())
      .post('/shop/discounts/validate')
      .set(f.auth(s1.shop))
      .send({ code: s1.inactive, cartSubtotal: 0, items: items(s1) })
      .expect(201);
    expect(body<{ message: string }>(admin).message).toBe(
      'This code is no longer active',
    );
  });

  it('the same generic message comes back from the quote and from order creation', async () => {
    const q = await quote(s1, s1.inactive);
    expect(body<{ reason: string }>(q).reason).toBe(
      'This code is not valid or cannot be applied',
    );
    const o = await order(s1, 'NOSUCHCODE2');
    expect(o.status).toBe(400);
    expect(msg(o)).toBe('This code is not valid or cannot be applied');
  });

  it('failures on four different routes spend ONE budget, then every route answers 429 with Retry-After', async () => {
    // 4 on validate, 3 on the quote, 3 on order creation = 10 distinct codes
    for (let i = 0; i < 4; i++) {
      expect((await validate(s2, `GUESSA${i}`)).status).toBe(201);
    }
    for (let i = 0; i < 3; i++) {
      expect((await quote(s2, `GUESSB${i}`)).status).toBe(201);
    }
    for (let i = 0; i < 3; i++) {
      expect((await order(s2, `GUESSC${i}`)).status).toBe(400);
    }
    for (const res of [
      await validate(s2, 'GUESSD'),
      await order(s2, 'GUESSF'),
      await giftValidate(s2, 'AAAA-BBBB'),
      // even the shop's REAL code: the budget is spent, the client waits
      await validate(s2, s2.valid),
    ]) {
      expect(res.status).toBe(429);
      expect(msg(res)).toBe('Too many attempts. Please try again later.');
      const wait = Number(res.headers['retry-after']);
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(900);
    }
    // the debounced quote answers in its own shape, with no error status and
    // nothing about any code
    const lockedQuote = await quote(s2, 'GUESSE');
    expect(lockedQuote.status).toBe(201);
    expect(body<Record<string, unknown>>(lockedQuote)).toMatchObject({
      status: 'unavailable',
      reason: 'Too many attempts. Please try again later.',
      total: null,
    });
    // a 429 does not write an order, and an order with no code is untouched
    const plain = await f.storefrontOrderRaw(s2.shop, items(s2));
    expect(plain.status).toBe(201);
  });

  it('a parallel burst across four routes cannot overshoot the budget: only 10 distinct codes reach a lookup', async () => {
    // 20 attempts fired at once, every one at a different wrong code. They all
    // arrive before any lookup has finished, so a limiter that counts only after
    // the lookup would let every one of them through.
    const attempts = [
      ...Array.from({ length: 4 }, (_, i) => validate(s6, `BURSTV${i}`)),
      ...Array.from({ length: 6 }, (_, i) => quote(s6, `BURSTQ${i}`)),
      ...Array.from({ length: 6 }, (_, i) => order(s6, `BURSTO${i}`)),
      ...Array.from({ length: 4 }, (_, i) => giftValidate(s6, `BURSTG-${i}`)),
    ];
    const results = await Promise.all(attempts);
    const locked = 'Too many attempts. Please try again later.';
    const limited = results.filter(
      (r) =>
        (r.status === 429 && msg(r) === locked) ||
        (r.status === 201 && (r.body as { reason?: string }).reason === locked),
    );
    expect(results).toHaveLength(20);
    expect(limited).toHaveLength(10);
    for (const r of limited.filter((x) => x.status === 429))
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    // and the budget really is spent
    expect((await validate(s6, s6.valid)).status).toBe(429);
  });

  it('a valid code gives its slot back: using the real code over and over never builds towards a lock', async () => {
    for (let i = 0; i < 12; i++) {
      const q = await quote(s5, s5.valid);
      expect(body<{ discountCode: string | null }>(q).discountCode).toBe(
        s5.valid,
      );
    }
    // and a rejection that needs the code to exist (minimum purchase) is free too
    for (let i = 0; i < 12; i++) {
      expect((await quote(s5, s5.minPurchase)).status).toBe(201);
    }
    expect(
      body<{ valid: boolean }>(await validate(s5, 'STILLFREE')).valid,
    ).toBe(false);
  });

  it('the lock is per shop: the same client is not locked out of another shop', async () => {
    const res = await validate(s5, s5.valid);
    expect(res.status).toBe(201);
    expect(body<{ valid: boolean }>(res).valid).toBe(true);
    // and the same code TEXT as the locked shop's real code means nothing here
    expect(body<{ valid: boolean }>(await validate(s5, s2.valid)).valid).toBe(
      false,
    );
  });

  it('a shopper who retypes a wrong code, or tries a few, still gets through with the real one', async () => {
    // the same wrong code five times (retyping, or a debounced quote re-sending
    // a stale code) spends one slot of the budget, not five
    // (through the quote: the validate route has its own 20 a minute)
    for (let i = 0; i < 5; i++) {
      expect(body<{ status: string }>(await quote(s3, 'TYPO')).status).toBe(
        'unavailable',
      );
    }
    for (const c of ['TYPO2', 'TYPO3']) await quote(s3, c);
    const ok = await validate(s3, s3.valid);
    expect(ok.status).toBe(201);
    expect(body<{ valid: boolean }>(ok).valid).toBe(true);
    const placed = await order(s3, s3.valid);
    expect(placed.status).toBe(201);
  });

  describe('gift cards', () => {
    async function issue(w: World, value: number) {
      const res = await request(f.http())
        .post('/gift-cards')
        .set(f.auth(w.shop))
        .send({ initialValue: value })
        .expect(201);
      return body<{ id: number; code: string }>(res);
    }

    it('failures are generic, carry no balance, and a disabled card looks like an unknown one', async () => {
      const card = await issue(s4, 75);
      const ok = await giftValidate(s4, card.code);
      expect(
        body<{ valid: boolean; remainingBalance: number }>(ok),
      ).toMatchObject({ valid: true, remainingBalance: 75 });
      await request(f.http())
        .patch(`/gift-cards/${card.id}`)
        .set(f.auth(s4.shop))
        .send({ status: 'disabled' })
        .expect(200);
      const disabled = await giftValidate(s4, card.code);
      const unknown = await giftValidate(s4, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
      expect(body<unknown>(disabled)).toEqual(body<unknown>(unknown));
      expect(body<Record<string, unknown>>(disabled)).toEqual({
        valid: false,
        message: 'This gift card code is not valid or cannot be applied',
      });
      expect(JSON.stringify(disabled.body)).not.toMatch(/75|remainingBalance/);
    });

    it('order creation with a bad gift card code is the same generic 400', async () => {
      const res = await f.storefrontOrderRaw(s4.shop, items(s4), {
        giftCardCode: 'NOPE-NOPE',
      });
      expect(res.status).toBe(400);
      expect(msg(res)).toBe(
        'This gift card code is not valid or cannot be applied',
      );
    });
  });
});
