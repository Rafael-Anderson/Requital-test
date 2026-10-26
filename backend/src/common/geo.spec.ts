import { haversineDistanceKm, isUsablePin } from './geo';

// Known-value checks derived from closed-form geodesy identities (not
// dependent on any "real-world" city-pair distance I might misremember):
// 1 degree of latitude, or 1 degree of longitude at the equator, is
// 2*pi*R/360 ≈ 111.19km; a quarter of the great circle is pi*R/2 ≈
// 10007.5km; half the circumference (antipodal-ish, same latitude) is
// pi*R ≈ 20015km.
describe('haversineDistanceKm', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistanceKm(25.2048, 55.2708, 25.2048, 55.2708)).toBeCloseTo(
      0,
      6,
    );
  });

  it('1 degree of longitude at the equator is ~111.19km', () => {
    expect(haversineDistanceKm(0, 0, 0, 1)).toBeCloseTo(111.19, 1);
  });

  it('1 degree of latitude is ~111.19km', () => {
    expect(haversineDistanceKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });

  it('a quarter of the great circle (equator to pole) is ~10007.5km', () => {
    expect(haversineDistanceKm(0, 0, 90, 0)).toBeCloseTo(10007.5, -1);
  });

  it('half the circumference along the equator is ~20015km', () => {
    expect(haversineDistanceKm(0, 0, 0, 180)).toBeCloseTo(20015.1, -1);
  });

  it('is symmetric (order of points does not matter)', () => {
    const a = haversineDistanceKm(25.2048, 55.2708, 24.4539, 54.3773);
    const b = haversineDistanceKm(24.4539, 54.3773, 25.2048, 55.2708);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe('isUsablePin', () => {
  it('accepts a real pair and rejects (0,0), out of range, non-finite and non-numbers', () => {
    expect(isUsablePin(25.2, 55.3)).toBe(true);
    expect(isUsablePin(0, 55.3)).toBe(true);
    expect(isUsablePin(0, 0)).toBe(false);
    expect(isUsablePin(91, 10)).toBe(false);
    expect(isUsablePin(10, -181)).toBe(false);
    expect(isUsablePin(NaN, 10)).toBe(false);
    expect(isUsablePin(10, Infinity)).toBe(false);
    expect(isUsablePin(null, null)).toBe(false);
    expect(isUsablePin('25.2', '55.3')).toBe(false);
  });
});
