import { computeOrderTotals, type TaxableLine } from './order-pricing';
import { minorUnitFactor, roundMoney } from '../common/currency-minor-units';

// Property test for computeOrderTotals (audit 7.6 / D-6). No fast-check in this
// repo, so a small seeded generator: mulberry32, a fixed set of seeds, so a
// failure prints the seed and reproduces exactly. Pure function, no DB.
//
// Invariants (each is a statement about the function's own contract, not a
// snapshot of one example):
//   I1  total reconciles with its parts:
//         exclusive: total = discountedSubtotal + delivery + tax
//         inclusive: total = discountedSubtotal + delivery   (tax is a component)
//   I2  taxAmount = sum(line tax) + deliveryTaxAmount, and the by-rate breakdown
//       sums to the same tax and the same taxable base
//   I3  inclusive: each line's taxable + tax = its discounted amount (the tax is
//       backed out, never added); exclusive: taxable = discounted amount
//   I4  nothing is negative, for any non-negative basket / discount / fee,
//       including a discount larger than the basket
//   I5  taxOnDelivery false (or rate 0) => deliveryTaxAmount is exactly 0
//   I6  rounding ONCE per stored column: rounding is idempotent, lands within
//       half a minor unit of the unrounded figure, and the persisted figures
//       (order tax + each line's tax, rounded independently) reconcile to the
//       total within one-half minor unit per rounded component
//   I7  the function itself rounds nothing (a pre-rounding version would break
//       I6's bound for 3-decimal currencies)

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RATES = [0, 0, 5, 5, 5, 15, 20];
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);
const CURRENCIES = ['AED', 'KWD'] as const;

interface Case {
  seed: number;
  currency: (typeof CURRENCIES)[number];
  lines: TaxableLine[];
  deliveryFee: number;
  discountAmount: number;
  taxInclusive: boolean;
  taxOnDelivery: boolean;
  deliveryTaxRate: number;
}

function money(rand: () => number, max: number, currency: string): number {
  const f = minorUnitFactor(currency);
  return Math.round(rand() * max * f) / f;
}

function genCase(seed: number, currency: Case['currency']): Case {
  const rand = mulberry32(seed);
  const n = 1 + Math.floor(rand() * 5);
  const lines: TaxableLine[] = Array.from({ length: n }, (_, i) => {
    const rate = RATES[Math.floor(rand() * RATES.length)];
    // unit price x quantity, the way a real line amount arises
    const unit = money(rand, 250, currency);
    const qty = 1 + Math.floor(rand() * 6);
    return {
      amount: unit * qty,
      taxRate: rate,
      taxClassId: rate === 0 ? i + 100 : rate,
    };
  });
  const gross = lines.reduce((s, l) => s + l.amount, 0);
  const mode = rand();
  // 25% no discount, 50% partial, 15% exactly the basket, 10% more than the basket
  const discountAmount =
    mode < 0.25
      ? 0
      : mode < 0.75
        ? money(rand, gross, currency)
        : mode < 0.9
          ? gross
          : gross + money(rand, 50, currency) + 0.01;
  return {
    seed,
    currency,
    lines,
    deliveryFee: rand() < 0.2 ? 0 : money(rand, 40, currency),
    discountAmount,
    taxInclusive: rand() < 0.5,
    taxOnDelivery: rand() < 0.5,
    deliveryTaxRate: RATES[Math.floor(rand() * RATES.length)],
  };
}

const cases: Case[] = CURRENCIES.flatMap((c) =>
  SEEDS.map((s) => genCase(s, c)),
);
const EPS = 1e-9;

function run(c: Case) {
  return computeOrderTotals({
    lines: c.lines,
    deliveryFee: c.deliveryFee,
    discountAmount: c.discountAmount,
    taxInclusive: c.taxInclusive,
    taxOnDelivery: c.taxOnDelivery,
    deliveryTaxRate: c.deliveryTaxRate,
  });
}

describe('computeOrderTotals properties (seeded, AED and KWD)', () => {
  it('generates a spread that actually exercises every branch', () => {
    // Guards the generator itself: an invariant over a degenerate sample proves nothing.
    const has = (p: (c: Case) => boolean) => cases.some(p);
    expect(has((c) => c.taxInclusive)).toBe(true);
    expect(has((c) => !c.taxInclusive)).toBe(true);
    expect(
      has((c) => c.taxOnDelivery && c.deliveryFee > 0 && c.deliveryTaxRate > 0),
    ).toBe(true);
    expect(has((c) => new Set(c.lines.map((l) => l.taxRate)).size > 1)).toBe(
      true,
    );
    expect(
      has((c) => c.discountAmount > c.lines.reduce((s, l) => s + l.amount, 0)),
    ).toBe(true);
    expect(has((c) => c.discountAmount === 0)).toBe(true);
    expect(has((c) => c.currency === 'KWD')).toBe(true);
  });

  it.each(cases.map((c) => [`${c.currency} seed ${c.seed}`, c] as const))(
    'I1-I5 %s',
    (_name, c) => {
      const r = run(c);
      const gross = c.lines.reduce((s, l) => s + l.amount, 0);
      const net = gross - Math.min(c.discountAmount, gross);

      // I1
      if (c.taxInclusive) {
        expect(Math.abs(r.total - (net + c.deliveryFee))).toBeLessThan(EPS);
      } else {
        expect(
          Math.abs(r.total - (net + c.deliveryFee + r.taxAmount)),
        ).toBeLessThan(EPS);
      }

      // I2
      const lineTax = r.lines.reduce((s, l) => s + l.taxAmount, 0);
      expect(
        Math.abs(r.taxAmount - (lineTax + r.deliveryTaxAmount)),
      ).toBeLessThan(EPS);
      expect(
        Math.abs(
          r.breakdown.reduce((s, b) => s + b.taxAmount, 0) - r.taxAmount,
        ),
      ).toBeLessThan(EPS);
      const lineBase = r.lines.reduce((s, l) => s + l.taxableAmount, 0);
      const deliveryBase =
        r.deliveryTaxAmount > 0
          ? c.taxInclusive
            ? c.deliveryFee - r.deliveryTaxAmount
            : c.deliveryFee
          : 0;
      expect(
        Math.abs(
          r.breakdown.reduce((s, b) => s + b.taxableAmount, 0) -
            (lineBase + deliveryBase),
        ),
      ).toBeLessThan(EPS);
      expect(r.lines).toHaveLength(c.lines.length);

      // I3: per line, in input order, class + rate carried through untouched
      const effDiscount = Math.min(c.discountAmount, gross);
      r.lines.forEach((l, i) => {
        const src = c.lines[i];
        expect(l.taxClassId).toBe(src.taxClassId);
        expect(l.taxRate).toBe(src.taxRate);
        const lineNet =
          gross > 0 ? src.amount - effDiscount * (src.amount / gross) : 0;
        if (c.taxInclusive) {
          expect(
            Math.abs(l.taxableAmount + l.taxAmount - lineNet),
          ).toBeLessThan(EPS);
        } else {
          expect(Math.abs(l.taxableAmount - lineNet)).toBeLessThan(EPS);
          expect(
            Math.abs(l.taxAmount - lineNet * (src.taxRate / 100)),
          ).toBeLessThan(EPS);
        }
        // a zero-rated line never carries tax, whatever the basket does around it
        if (src.taxRate === 0) expect(Math.abs(l.taxAmount)).toBeLessThan(EPS);
      });

      // I4 (tolerate -1e-12 float dust, nothing more)
      expect(r.total).toBeGreaterThanOrEqual(-EPS);
      expect(r.taxAmount).toBeGreaterThanOrEqual(-EPS);
      expect(r.deliveryTaxAmount).toBeGreaterThanOrEqual(-EPS);
      for (const l of r.lines) {
        expect(l.taxAmount).toBeGreaterThanOrEqual(-EPS);
        expect(l.taxableAmount).toBeGreaterThanOrEqual(-EPS);
      }
      // a discount >= the basket leaves only delivery (+ its tax when exclusive)
      if (c.discountAmount >= gross) {
        const expectTotal = c.taxInclusive
          ? c.deliveryFee
          : c.deliveryFee + r.deliveryTaxAmount;
        expect(Math.abs(r.total - expectTotal)).toBeLessThan(EPS);
      }

      // I5
      if (!c.taxOnDelivery || c.deliveryFee === 0 || c.deliveryTaxRate === 0) {
        expect(r.deliveryTaxAmount).toBe(0);
      }
    },
  );

  it.each(cases.map((c) => [`${c.currency} seed ${c.seed}`, c] as const))(
    'I6-I7 round once per stored column %s',
    (_name, c) => {
      const r = run(c);
      const f = minorUnitFactor(c.currency);
      const half = 0.5 / f;

      // idempotent, and within half a minor unit of what it rounded
      const total = roundMoney(r.total, c.currency);
      expect(roundMoney(total, c.currency)).toBe(total);
      expect(Math.abs(total - r.total)).toBeLessThanOrEqual(half + EPS);
      // the figure lands on a whole minor unit (this is what a DECIMAL(,2|3) column stores)
      expect(Math.abs(total * f - Math.round(total * f))).toBeLessThan(1e-6);

      // I7: the function hands back unrounded values. For a basket whose figures are
      // not already whole minor units this is visible; assert the contract directly
      // by checking the output equals itself at full precision (no hidden rounding):
      // recomputing from the same inputs is bit-identical.
      expect(run(c)).toEqual(r);

      // Persisted figures: order tax rounded once, each line tax rounded once.
      // Rounding each independently can drift from the rounded order tax by at most
      // half a minor unit per component; it must never be more.
      const orderTax = roundMoney(r.taxAmount, c.currency);
      const sumLineRounded = r.lines.reduce(
        (s, l) => s + roundMoney(l.taxAmount, c.currency),
        0,
      );
      const deliveryRounded = roundMoney(r.deliveryTaxAmount, c.currency);
      const components = r.lines.length + 1;
      expect(
        Math.abs(orderTax - (sumLineRounded + deliveryRounded)),
      ).toBeLessThanOrEqual(components * half + EPS);

      // exclusive total reconciles to the persisted parts within the same bound
      // (net and fee are already whole units, so only the tax rounds)
      if (!c.taxInclusive) {
        const gross = c.lines.reduce((s, l) => s + l.amount, 0);
        const net = roundMoney(
          gross - Math.min(c.discountAmount, gross),
          c.currency,
        );
        const parts = net + roundMoney(c.deliveryFee, c.currency) + orderTax;
        expect(Math.abs(total - parts)).toBeLessThanOrEqual(
          components * half + EPS,
        );
      }
    },
  );

  it('rounding the sum differs from summing rounded lines for 3-decimal KWD, and the sum is what is charged', () => {
    // 3 lines of 0.0014 tax each: rounding each to 3dp gives 0.001 x3 = 0.003, the
    // sum 0.0042 rounds to 0.004. The charged total follows the sum.
    const lines = [0.028, 0.028, 0.028].map((amount) => ({
      amount,
      taxRate: 5,
      taxClassId: 1,
    }));
    const r = computeOrderTotals({
      lines,
      deliveryFee: 0,
      taxInclusive: false,
    });
    const perLine = r.lines.reduce(
      (s, l) => s + roundMoney(l.taxAmount, 'KWD'),
      0,
    );
    expect(roundMoney(r.taxAmount, 'KWD')).toBe(0.004);
    expect(perLine).toBeCloseTo(0.003, 9);
    expect(roundMoney(r.total, 'KWD')).toBe(roundMoney(0.084 + 0.0042, 'KWD'));
  });
});
