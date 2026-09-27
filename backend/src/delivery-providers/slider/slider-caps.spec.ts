import {
  assertPaymentOnDeliveryWithinCap,
  assertScheduleAtOk,
  assertVehicleDistanceOk,
} from './slider-caps';

describe('slider-caps', () => {
  describe('assertPaymentOnDeliveryWithinCap', () => {
    it('allows a cash_on_delivery order at or under AED 350', () => {
      expect(() =>
        assertPaymentOnDeliveryWithinCap('cash_on_delivery', 350, 'AED'),
      ).not.toThrow();
      expect(() =>
        assertPaymentOnDeliveryWithinCap('cash_on_delivery', 100, 'AED'),
      ).not.toThrow();
    });

    it('rejects a cash_on_delivery order over AED 350', () => {
      expect(() =>
        assertPaymentOnDeliveryWithinCap('cash_on_delivery', 350.01, 'AED'),
      ).toThrow(/AED 350/);
    });

    it('allows a card_on_delivery order at or under AED 500', () => {
      expect(() =>
        assertPaymentOnDeliveryWithinCap('card_on_delivery', 500, 'AED'),
      ).not.toThrow();
    });

    it('rejects a card_on_delivery order over AED 500', () => {
      expect(() =>
        assertPaymentOnDeliveryWithinCap('card_on_delivery', 500.5, 'AED'),
      ).toThrow(/AED 500/);
    });

    it('ignores the cap entirely for any other payment method', () => {
      expect(() =>
        assertPaymentOnDeliveryWithinCap('card_online', 10000, 'AED'),
      ).not.toThrow();
      expect(() => assertPaymentOnDeliveryWithinCap(null, 10000, 'AED')).not.toThrow();
    });
  });

  describe('assertVehicleDistanceOk', () => {
    it('allows a bike delivery at or under 35km', () => {
      expect(() => assertVehicleDistanceOk('bike', 35)).not.toThrow();
      expect(() => assertVehicleDistanceOk('bike', 10)).not.toThrow();
    });

    it('rejects a bike delivery over 35km', () => {
      expect(() => assertVehicleDistanceOk('bike', 35.1)).toThrow(/35km/);
    });

    it('never caps car or any', () => {
      expect(() => assertVehicleDistanceOk('car', 200)).not.toThrow();
      expect(() => assertVehicleDistanceOk('any', 200)).not.toThrow();
    });
  });

  describe('assertScheduleAtOk', () => {
    it('allows a null/undefined scheduleAt (immediate dispatch)', () => {
      expect(() => assertScheduleAtOk(null)).not.toThrow();
      expect(() => assertScheduleAtOk(undefined)).not.toThrow();
    });

    it('allows a schedule at least 30 minutes out', () => {
      const scheduleAt = new Date(Date.now() + 31 * 60_000).toISOString();
      expect(() => assertScheduleAtOk(scheduleAt)).not.toThrow();
    });

    it('rejects a schedule under 30 minutes out', () => {
      const scheduleAt = new Date(Date.now() + 10 * 60_000).toISOString();
      expect(() => assertScheduleAtOk(scheduleAt)).toThrow(/30 minutes/);
    });

    it('rejects an invalid date string', () => {
      expect(() => assertScheduleAtOk('not-a-date')).toThrow(/valid ISO 8601/);
    });
  });
});

describe('assertPaymentOnDeliveryWithinCap currency guard', () => {
  it('refuses a non-AED order rather than comparing it to an AED cap', () => {
    // 400 OMR is roughly ten times Slider's real 350 AED cash cap, so a naive
    // numeric comparison would PASS it. Refusing is the honest outcome.
    expect(() =>
      assertPaymentOnDeliveryWithinCap('cash_on_delivery', 400, 'OMR'),
    ).toThrow(/AED orders only/);
  });

  it('refuses even when the amount would be under the cap', () => {
    // The guard is about the unit being wrong, not the number being too big.
    expect(() =>
      assertPaymentOnDeliveryWithinCap('cash_on_delivery', 10, 'KWD'),
    ).toThrow(/AED orders only/);
  });

  it('is case- and whitespace-insensitive about the code', () => {
    expect(() =>
      assertPaymentOnDeliveryWithinCap('cash_on_delivery', 10, ' aed '),
    ).not.toThrow();
  });

  it('still lets a non-payment-on-delivery order through — but only in AED', () => {
    expect(() =>
      assertPaymentOnDeliveryWithinCap('card_online', 9999, 'AED'),
    ).not.toThrow();
  });
});
