import {
  clawbackTarget,
  earnBaseMinor,
  earnPoints,
  parseRate,
  redeemCreditMinor,
} from './loyalty-math';

describe('loyalty math', () => {
  it('parses exact decimal rates and rejects everything else', () => {
    expect(parseRate('1')).toBe(10000n);
    expect(parseRate('0.5')).toBe(5000n);
    expect(parseRate('12.3456')).toBe(123456n);
    expect(parseRate(2)).toBe(20000n);
    for (const bad of [
      '-1',
      '1e3',
      '1.23456',
      '',
      'abc',
      null,
      '١٢',
      '123456789',
    ])
      expect(parseRate(bad)).toBeNull();
  });

  const o = {
    total: '120.000000000000000000000000000000',
    deliveryFee: '10',
    taxAmount: '5',
    giftCardAmount: '20',
    storeCreditAmount: '15',
    currency: 'AED',
  };
  it('net_paid excludes delivery, tax and both tenders; items_after_discount keeps the tenders', () => {
    expect(earnBaseMinor(o, 'net_paid')).toBe(7000);
    expect(earnBaseMinor(o, 'items_after_discount')).toBe(10500);
  });
  it('never goes negative', () => {
    expect(
      earnBaseMinor(
        { ...o, total: '10', deliveryFee: '10', taxAmount: '5' },
        'net_paid',
      ),
    ).toBe(0);
  });
  it('rounds points down on the minor unit, for 2dp and 3dp currencies', () => {
    expect(earnPoints(7000, parseRate('1')!, 'AED')).toBe(70);
    expect(earnPoints(9999, parseRate('1')!, 'AED')).toBe(99); // 99.99 -> 99
    expect(earnPoints(10505, parseRate('1')!, 'KWD')).toBe(10); // 10.505 KWD
    expect(earnPoints(10505, parseRate('0.5')!, 'KWD')).toBe(5);
    expect(earnPoints(100, parseRate('0')!, 'AED')).toBe(0);
    // large figures do not lose precision
    expect(earnPoints(900_000_000_00, parseRate('9999.9999')!, 'AED')).toBe(
      Number((90_000_000_000n * 99999999n) / 1000000n),
    );
  });
  it('clawback targets are cumulative, exact, capped at what was earned', () => {
    expect(clawbackTarget(70, 3500, 10000)).toBe(24); // floor(24.5)
    expect(clawbackTarget(70, 10000, 10000)).toBe(70);
    expect(clawbackTarget(70, 99999, 10000)).toBe(70);
    expect(clawbackTarget(0, 5000, 10000)).toBe(0);
    expect(clawbackTarget(70, 0, 10000)).toBe(0);
    // partial returns sum exactly to the whole
    const first = clawbackTarget(70, 3500, 10000);
    const second = clawbackTarget(70, 10000, 10000) - first;
    expect(first + second).toBe(70);
  });
  it('redeem converts points to minor units, rounding down', () => {
    expect(redeemCreditMinor(100, parseRate('100')!, 'AED')).toBe(100); // 100 pts = 1 AED
    expect(redeemCreditMinor(150, parseRate('100')!, 'AED')).toBe(150);
    expect(redeemCreditMinor(1, parseRate('300')!, 'AED')).toBe(0);
    expect(redeemCreditMinor(100, parseRate('100')!, 'KWD')).toBe(1000);
    expect(redeemCreditMinor(100, parseRate('0')!, 'AED')).toBe(0);
  });
});
