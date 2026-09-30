import {
  computeOrderTotals,
  matchDeliveryZone,
  matchDeliveryZoneByRegion,
} from './order-pricing';

describe('matchDeliveryZone', () => {
  const zones = [
    { name: 'Downtown', isActive: true },
    { name: 'Dubai', isActive: true },
    { name: 'Sharjah', isActive: false },
  ];

  it('matches by area first, case-insensitively', () => {
    expect(matchDeliveryZone(zones, 'downtown', 'Dubai')?.name).toBe(
      'Downtown',
    );
  });

  it('falls back to emirate when area does not match any zone', () => {
    expect(matchDeliveryZone(zones, 'Some Random Area', 'Dubai')?.name).toBe(
      'Dubai',
    );
  });

  it('falls back to emirate when area is omitted', () => {
    expect(matchDeliveryZone(zones, undefined, 'Dubai')?.name).toBe('Dubai');
  });

  it('returns null when neither area nor emirate match any active zone', () => {
    expect(matchDeliveryZone(zones, 'Nowhere', 'Fujairah')).toBeNull();
  });

  it('never matches an inactive zone, even by exact name', () => {
    expect(matchDeliveryZone(zones, 'Sharjah', 'Sharjah')).toBeNull();
  });
});

describe('matchDeliveryZone by map circle (SHP-1)', () => {
  // Real-ish Dubai points. The Marina pin is ~1.4km from the Marina centre and
  // ~14km from Downtown, so the circles below are unambiguous.
  const MARINA_CENTER = { lat: 25.0805, lng: 55.1403 };
  const IN_MARINA = { lat: 25.0905, lng: 55.1453 };
  const DOWNTOWN = { lat: 25.1972, lng: 55.2744 };

  const marina = {
    id: 1,
    name: 'Marina',
    isActive: true,
    lat: String(MARINA_CENTER.lat), // mysql2 hands DECIMAL back as a string
    lng: String(MARINA_CENTER.lng),
    radiusKm: '3.00',
  };
  const dubai = { id: 2, name: 'Dubai', isActive: true };

  it('the audit D-3 case: "Dubai Marina" vs a zone named "Marina" used to fall through to the emirate-wide zone, and the pin now resolves it', () => {
    const zones = [marina, dubai];
    // Name-only behaviour (no pin): unchanged, lands on the emirate zone.
    expect(matchDeliveryZone(zones, 'Dubai Marina', 'Dubai')?.name).toBe(
      'Dubai',
    );
    // With the customer's pin inside the drawn circle: the specific zone.
    expect(
      matchDeliveryZone(zones, 'Dubai Marina', 'Dubai', IN_MARINA)?.name,
    ).toBe('Marina');
  });

  it('an exact area-name match still wins over a circle match', () => {
    const downtown = { id: 3, name: 'Downtown', isActive: true };
    expect(
      matchDeliveryZone(
        [marina, downtown, dubai],
        'downtown',
        'Dubai',
        IN_MARINA,
      )?.name,
    ).toBe('Downtown');
  });

  it('a pin outside every circle falls back to the emirate zone, as before', () => {
    expect(
      matchDeliveryZone([marina, dubai], 'Somewhere', 'Dubai', DOWNTOWN)?.name,
    ).toBe('Dubai');
  });

  it('with no pin the circle is never consulted', () => {
    expect(
      matchDeliveryZone([marina], 'Dubai Marina', 'Dubai', null),
    ).toBeNull();
    expect(matchDeliveryZone([marina], 'Dubai Marina', 'Dubai')).toBeNull();
  });

  it('a zone with no circle, or an incomplete one, is invisible to location matching', () => {
    const noRadius = { ...marina, radiusKm: null };
    const noLat = { ...marina, lat: null };
    expect(
      matchDeliveryZone([noRadius, noLat], 'x', 'Fujairah', IN_MARINA),
    ).toBeNull();
  });

  it("a zone still on the admin modal's default, unplaced centre never decides a fee, however wide its radius", () => {
    const unplaced = {
      id: 9,
      name: 'Never placed',
      isActive: true,
      lat: '23.850000',
      lng: '54.400000',
      radiusKm: '100.00',
    };
    // A point inside that 100km circle.
    expect(
      matchDeliveryZone([unplaced], 'x', 'Fujairah', { lat: 23.9, lng: 54.45 }),
    ).toBeNull();
  });

  it('an inactive zone never matches by circle', () => {
    expect(
      matchDeliveryZone(
        [{ ...marina, isActive: false }],
        'x',
        'Fujairah',
        IN_MARINA,
      ),
    ).toBeNull();
  });

  it('overlapping circles: the tightest wins, regardless of row order', () => {
    const wide = { ...marina, id: 5, name: 'Dubai South', radiusKm: '15.00' };
    const tight = { ...marina, id: 6, name: 'Marina Walk', radiusKm: '1.50' };
    expect(
      matchDeliveryZone([wide, tight], 'x', 'Fujairah', IN_MARINA)?.name,
    ).toBe('Marina Walk');
    expect(
      matchDeliveryZone([tight, wide], 'x', 'Fujairah', IN_MARINA)?.name,
    ).toBe('Marina Walk');
  });

  it('equal radius: the nearer centre wins, then the lower id', () => {
    const far = { ...marina, id: 7, name: 'Far', lat: '25.0705' };
    const near = { ...marina, id: 8, name: 'Near' };
    expect(
      matchDeliveryZone([far, near], 'x', 'Fujairah', IN_MARINA)?.name,
    ).toBe('Near');
    const twinA = { ...marina, id: 10, name: 'Twin A' };
    const twinB = { ...marina, id: 11, name: 'Twin B' };
    expect(
      matchDeliveryZone([twinB, twinA], 'x', 'Fujairah', IN_MARINA)?.name,
    ).toBe('Twin A');
  });

  it('the boundary is inclusive, like the outlet radius check', () => {
    // A point exactly radiusKm due north of the centre (1 deg lat = 111.195km
    // for the 6371km sphere haversine uses).
    const radiusKm = 5;
    const onEdge = {
      lat: MARINA_CENTER.lat + radiusKm / 111.19492664455873,
      lng: MARINA_CENTER.lng,
    };
    const zone = { ...marina, radiusKm: String(radiusKm) };
    expect(matchDeliveryZone([zone], 'x', 'Fujairah', onEdge)?.name).toBe(
      'Marina',
    );
    const justOutside = { ...onEdge, lat: onEdge.lat + 0.001 };
    expect(matchDeliveryZone([zone], 'x', 'Fujairah', justOutside)).toBeNull();
  });
});

describe('matchDeliveryZoneByRegion', () => {
  const DUBAI = 2;
  const SHARJAH = 3;
  const AJMAN = 4;
  const multi = {
    id: 1,
    name: 'DXB/SHJ/AJM',
    isActive: true,
    regionIds: [DUBAI, SHARJAH, AJMAN],
  };
  const dubaiOnly = {
    id: 2,
    name: 'Anything',
    isActive: true,
    regionIds: [DUBAI],
  };

  it('matches by the customer region, never by the zone name: the DXB/SHJ/AJM case', () => {
    expect(matchDeliveryZoneByRegion([multi], SHARJAH)?.name).toBe(
      'DXB/SHJ/AJM',
    );
    expect(matchDeliveryZoneByRegion([multi], 99)).toBeNull();
  });

  it('a zone named "Dubai" with no region set does not match the Dubai region', () => {
    const byNameOnly = { id: 9, name: 'Dubai', isActive: true, regionIds: [] };
    expect(matchDeliveryZoneByRegion([byNameOnly], DUBAI)).toBeNull();
  });

  it('the zone covering the fewest regions is the most specific and wins, in any row order', () => {
    expect(matchDeliveryZoneByRegion([multi, dubaiOnly], DUBAI)?.id).toBe(2);
    expect(matchDeliveryZoneByRegion([dubaiOnly, multi], DUBAI)?.id).toBe(2);
  });

  it('equal specificity falls to the lowest id', () => {
    const a = { id: 5, name: 'A', isActive: true, regionIds: [DUBAI] };
    const b = { id: 6, name: 'B', isActive: true, regionIds: [DUBAI] };
    expect(matchDeliveryZoneByRegion([b, a], DUBAI)?.id).toBe(5);
  });

  it('a placed circle containing the pin beats any region match', () => {
    const circle = {
      id: 7,
      name: 'Marina',
      isActive: true,
      regionIds: [],
      lat: '25.0805',
      lng: '55.1403',
      radiusKm: '3.00',
    };
    const pin = { lat: 25.0905, lng: 55.1453 };
    expect(matchDeliveryZoneByRegion([dubaiOnly, circle], DUBAI, pin)?.id).toBe(
      7,
    );
    // Pin elsewhere: the region answer stands.
    expect(
      matchDeliveryZoneByRegion([dubaiOnly, circle], DUBAI, {
        lat: 25.3,
        lng: 55.5,
      })?.id,
    ).toBe(2);
  });

  it('never matches an inactive zone, and needs a region or a pin to match anything', () => {
    expect(
      matchDeliveryZoneByRegion([{ ...dubaiOnly, isActive: false }], DUBAI),
    ).toBeNull();
    expect(matchDeliveryZoneByRegion([dubaiOnly], null)).toBeNull();
    expect(matchDeliveryZoneByRegion([dubaiOnly], undefined)).toBeNull();
  });
});

// One helper so each case reads as "these lines, this shop setting" rather than
// a wall of object literals. `rate` is a percentage; taxClassId is carried
// through untouched and only asserted where it matters.
function line(amount: number, rate: number, taxClassId: number | null = 1) {
  return { amount, taxRate: rate, taxClassId };
}

describe('computeOrderTotals', () => {
  // The two cases that existed before per-line tax, restated against the new
  // signature. A single-rate basket must behave exactly as it always did - that
  // is what makes this change safe for every shop that has one rate.
  it('exclusive tax: adds tax on top of the lines, not the delivery fee', () => {
    const { taxAmount, total } = computeOrderTotals({
      lines: [line(100, 5)],
      deliveryFee: 10,
      taxInclusive: false,
    });
    expect(taxAmount).toBeCloseTo(5, 6);
    expect(total).toBeCloseTo(115, 6);
  });

  it('inclusive tax: backs the tax out, total is lines + delivery only', () => {
    const { taxAmount, total } = computeOrderTotals({
      lines: [line(105, 5)],
      deliveryFee: 10,
      taxInclusive: true,
    });
    expect(taxAmount).toBeCloseTo(5, 6);
    expect(total).toBeCloseTo(115, 6);
  });

  it.each([true, false])(
    'a zero rate yields zero tax with taxInclusive=%s',
    (taxInclusive) => {
      expect(
        computeOrderTotals({
          lines: [line(100, 0)],
          deliveryFee: 0,
          taxInclusive,
        }).taxAmount,
      ).toBe(0);
    },
  );

  // THE case this whole phase exists for. Before per-line tax, one shop rate hit
  // the entire subtotal, so a zero-rated or exempt product was charged VAT it
  // does not owe and the merchant filed a wrong return.
  it('taxes each line at its own rate, mixing standard, zero and exempt', () => {
    const result = computeOrderTotals({
      lines: [
        line(100, 5, 1), // standard
        line(50, 0, 2), // zero rated
        line(30, 0, 3), // exempt - same 0%, different class
      ],
      deliveryFee: 0,
      taxInclusive: false,
    });
    // 5% of the standard line only, NOT of 180.
    expect(result.taxAmount).toBeCloseTo(5, 6);
    expect(result.total).toBeCloseTo(185, 6);
    expect(result.lines.map((l) => l.taxAmount)).toEqual([5, 0, 0]);
    // The per-line capture carries the class through, so the orderitem row can
    // record which class was applied, not just the rate.
    expect(result.lines.map((l) => l.taxClassId)).toEqual([1, 2, 3]);
  });

  it('groups the breakdown by rate, standard first, for a VAT document', () => {
    const { breakdown } = computeOrderTotals({
      lines: [line(100, 5), line(200, 5), line(50, 0, 2)],
      deliveryFee: 0,
      taxInclusive: false,
    });
    expect(breakdown).toEqual([
      { taxRate: 5, taxableAmount: 300, taxAmount: 15 },
      { taxRate: 0, taxableAmount: 50, taxAmount: 0 },
    ]);
  });

  // An order-level discount has no single base to reduce once rates differ, so
  // it is apportioned pro rata. Tax is owed on what the customer actually pays.
  it('apportions an order-level discount across lines pro rata', () => {
    const result = computeOrderTotals({
      lines: [line(100, 5), line(300, 5)],
      deliveryFee: 0,
      discountAmount: 40,
      taxInclusive: false,
    });
    // 10 off the first line, 30 off the second.
    expect(result.lines[0].taxableAmount).toBeCloseTo(90, 6);
    expect(result.lines[1].taxableAmount).toBeCloseTo(270, 6);
    expect(result.taxAmount).toBeCloseTo(18, 6); // 5% of 360, not of 400
    expect(result.total).toBeCloseTo(378, 6);
  });

  it('apportioning a discount only reduces the taxed line when the other is zero rated', () => {
    const result = computeOrderTotals({
      lines: [line(100, 5), line(100, 0, 2)],
      deliveryFee: 0,
      discountAmount: 50,
      taxInclusive: false,
    });
    // Half the discount lands on each line; only the standard line owes tax.
    expect(result.lines[0].taxableAmount).toBeCloseTo(75, 6);
    expect(result.taxAmount).toBeCloseTo(3.75, 6);
  });

  it('never lets a discount larger than the basket produce negative tax', () => {
    const result = computeOrderTotals({
      lines: [line(100, 5)],
      deliveryFee: 10,
      discountAmount: 500,
      taxInclusive: false,
    });
    expect(result.taxAmount).toBe(0);
    expect(result.total).toBeCloseTo(10, 6);
  });

  it('handles a zero-value basket without dividing by zero', () => {
    const result = computeOrderTotals({
      lines: [line(0, 5)],
      deliveryFee: 0,
      discountAmount: 10,
      taxInclusive: false,
    });
    expect(result.taxAmount).toBe(0);
    expect(result.total).toBe(0);
    expect(Number.isNaN(result.lines[0].taxableAmount)).toBe(false);
  });

  // shop.taxOnDelivery, off by default: the behaviour this function has always
  // had is that delivery is untaxed.
  it('leaves the delivery fee untaxed by default', () => {
    const result = computeOrderTotals({
      lines: [line(100, 5)],
      deliveryFee: 20,
      taxInclusive: false,
    });
    expect(result.deliveryTaxAmount).toBe(0);
    expect(result.taxAmount).toBeCloseTo(5, 6);
    expect(result.total).toBeCloseTo(125, 6);
  });

  it('taxes the delivery fee when the shop opts in, at the shop rate', () => {
    const result = computeOrderTotals({
      lines: [line(100, 5)],
      deliveryFee: 20,
      taxInclusive: false,
      taxOnDelivery: true,
      deliveryTaxRate: 5,
    });
    expect(result.deliveryTaxAmount).toBeCloseTo(1, 6);
    expect(result.taxAmount).toBeCloseTo(6, 6);
    expect(result.total).toBeCloseTo(126, 6);
    // It joins the 5% group rather than appearing as its own rate.
    expect(result.breakdown).toEqual([
      { taxRate: 5, taxableAmount: 120, taxAmount: 6 },
    ]);
  });

  it('taxes delivery inclusively on an inclusive shop, without inflating the total', () => {
    const result = computeOrderTotals({
      lines: [line(105, 5)],
      deliveryFee: 21,
      taxInclusive: true,
      taxOnDelivery: true,
      deliveryTaxRate: 5,
    });
    expect(result.deliveryTaxAmount).toBeCloseTo(1, 6);
    expect(result.taxAmount).toBeCloseTo(6, 6);
    // Inclusive means the fee already contains its tax: the customer pays 126.
    expect(result.total).toBeCloseTo(126, 6);
  });

  it('ignores taxOnDelivery when there is no fee or no rate', () => {
    for (const params of [
      { deliveryFee: 0, deliveryTaxRate: 5 },
      { deliveryFee: 20, deliveryTaxRate: 0 },
    ]) {
      expect(
        computeOrderTotals({
          lines: [line(100, 0, 2)],
          taxInclusive: false,
          taxOnDelivery: true,
          ...params,
        }).deliveryTaxAmount,
      ).toBe(0);
    }
  });

  // The rounding policy: this function computes at FULL precision and rounds
  // nothing. Callers round once per stored column at persist (roundMoney with
  // the order's own currency). Pinned here because a function that pre-rounded
  // would make the per-line captures and the order total disagree.
  it('returns unrounded values, leaving rounding to the persist boundary', () => {
    const result = computeOrderTotals({
      lines: [line(33.33, 5), line(33.33, 5), line(33.34, 5)],
      deliveryFee: 0,
      taxInclusive: false,
    });
    // 5% of 33.33 is 1.6665 - not a representable fils amount, and deliberately
    // returned as-is.
    expect(result.lines[0].taxAmount).toBeCloseTo(1.6665, 10);
    expect(result.taxAmount).toBeCloseTo(5, 10);
    // And the parts still reconcile to the whole at full precision.
    const sum = result.lines.reduce((s, l) => s + l.taxAmount, 0);
    expect(sum).toBeCloseTo(result.taxAmount, 10);
  });

  it('keeps the inclusive back-out exact for a 3-decimal currency amount', () => {
    const result = computeOrderTotals({
      lines: [line(10.5, 5)],
      deliveryFee: 0,
      taxInclusive: true,
    });
    expect(result.lines[0].taxableAmount).toBeCloseTo(10, 6);
    expect(result.taxAmount).toBeCloseTo(0.5, 6);
    expect(result.total).toBeCloseTo(10.5, 6);
  });
});
