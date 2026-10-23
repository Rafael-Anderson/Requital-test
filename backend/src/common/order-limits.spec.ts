import { BadRequestException } from '@nestjs/common';
import {
  assertOrderWithinLimits,
  measureOrder,
  MAX_GIFT_CARD_UNITS,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  MAX_ORDER_UNITS,
} from './order-limits';

const line = (quantity: number, isGiftCard = false) => ({
  quantity,
  product: { isGiftCard },
});

describe('assertOrderWithinLimits', () => {
  it('accepts a basket at every ceiling', () => {
    expect(() =>
      assertOrderWithinLimits(
        Array.from({ length: MAX_ORDER_LINES }, () => line(10)),
      ),
    ).not.toThrow();
    expect(() =>
      assertOrderWithinLimits([
        line(MAX_LINE_QUANTITY),
        line(MAX_ORDER_UNITS - MAX_LINE_QUANTITY),
      ]),
    ).not.toThrow();
    expect(() =>
      assertOrderWithinLimits([line(MAX_GIFT_CARD_UNITS, true)]),
    ).not.toThrow();
  });

  it.each([
    [
      'too many lines',
      Array.from({ length: MAX_ORDER_LINES + 1 }, () => line(1)),
      /different items/,
    ],
    ['a line over the per-line cap', [line(MAX_LINE_QUANTITY + 1)], /per item/],
    [
      'units over the cart-wide cap',
      [line(600), line(401)],
      /1000 items per order/,
    ],
    [
      'gift cards over the cap on one line',
      [line(MAX_GIFT_CARD_UNITS + 1, true)],
      /gift cards/,
    ],
    [
      'gift cards over the cap across lines',
      [line(11, true), line(10, true)],
      /gift cards/,
    ],
  ])('refuses %s with a 400 and a clear message', (_n, lines, re) => {
    try {
      assertOrderWithinLimits(lines);
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).message).toMatch(re);
    }
  });

  it('counts a plain product the same whether or not it has a product row flag', () => {
    expect(() => assertOrderWithinLimits([{ quantity: 500 }])).not.toThrow();
  });

  describe('against what an existing order already holds', () => {
    const was = measureOrder([line(700), line(500)]); // 1200 units, over the cap

    it('lets an edit lower or keep an oversize order', () => {
      expect(() =>
        assertOrderWithinLimits([line(650), line(500)], was),
      ).not.toThrow();
      expect(() =>
        assertOrderWithinLimits([line(700), line(500)], was),
      ).not.toThrow();
    });
    it('refuses an edit that makes it bigger', () => {
      expect(() =>
        assertOrderWithinLimits([line(700), line(600)], was),
      ).toThrow(/1000 items per order/);
    });
    it('judges each dimension on its own: more gift cards is refused even when units fall', () => {
      const before = measureOrder([line(990), line(2, true)]);
      expect(() =>
        assertOrderWithinLimits([line(900), line(25, true)], before),
      ).toThrow(/gift cards/);
    });
  });
});
