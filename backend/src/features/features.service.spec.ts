import { resolveFlag } from './features.service';
import { FEATURE_KEYS, FEATURE_KEY_LIST, isFeatureKey } from './feature-keys';

const columnDef = {
  source: 'column',
  column: 'sliderEnabled',
  default: false,
  description: 'x',
} as const;
const tableDef = { source: 'table', default: true, description: 'y' } as const;

describe('resolveFlag precedence', () => {
  it('override beats the column, both directions', () => {
    expect(resolveFlag(columnDef, true, false, undefined)).toBe(true);
    expect(resolveFlag(columnDef, false, true, undefined)).toBe(false);
  });

  it('with no override the shop column decides', () => {
    expect(resolveFlag(columnDef, undefined, true, undefined)).toBe(true);
    expect(resolveFlag(columnDef, undefined, false, undefined)).toBe(false);
  });

  it('a NULL column falls to the registry default', () => {
    expect(resolveFlag(columnDef, undefined, null, undefined)).toBe(false);
    expect(
      resolveFlag({ ...columnDef, default: true }, undefined, null, undefined),
    ).toBe(true);
  });

  it('a table-backed key ignores any column value and uses override, then default', () => {
    expect(resolveFlag(tableDef, undefined, false, undefined)).toBe(true);
    expect(resolveFlag(tableDef, false, undefined, true)).toBe(false);
  });
});

describe('resolveFlag entitlement ceiling (PLT-1): override ?? (entitled && preferred)', () => {
  it('fails open: no plan opinion (undefined) is the same as entitled', () => {
    for (const col of [true, false, null]) {
      expect(resolveFlag(columnDef, undefined, col, undefined)).toBe(
        resolveFlag(columnDef, undefined, col, true),
      );
    }
    expect(resolveFlag(columnDef, undefined, true, undefined)).toBe(true);
  });

  it('an unentitled key is off even when the merchant switched it on', () => {
    expect(resolveFlag(columnDef, undefined, true, false)).toBe(false);
    expect(resolveFlag(tableDef, undefined, undefined, false)).toBe(false);
  });

  it('entitlement never switches a feature ON: the merchant preference still decides', () => {
    expect(resolveFlag(columnDef, undefined, false, true)).toBe(false);
  });

  it('a platform override beats entitlement in both directions', () => {
    expect(resolveFlag(columnDef, true, false, false)).toBe(true);
    expect(resolveFlag(columnDef, false, true, true)).toBe(false);
  });

  it('matches the pre-billing formula for every legacy (entitled) input', () => {
    // pre-billing: override ?? column ?? default
    const old = (o: boolean | undefined, c: boolean | null, d: boolean) =>
      o !== undefined ? o : c != null ? c : d;
    for (const o of [undefined, true, false])
      for (const c of [true, false, null])
        for (const d of [true, false])
          expect(resolveFlag({ ...columnDef, default: d }, o, c, true)).toBe(
            old(o, c, d),
          );
  });
});

describe('registry', () => {
  it('every key is recognised and column-backed keys name distinct shop columns', () => {
    const cols = FEATURE_KEY_LIST.flatMap((k) => {
      const d = FEATURE_KEYS[k];
      return d.source === 'column' ? [d.column] : [];
    });
    expect(new Set(cols).size).toBe(cols.length);
    for (const k of FEATURE_KEY_LIST) expect(isFeatureKey(k)).toBe(true);
    expect(isFeatureKey('constructor')).toBe(false);
    expect(isFeatureKey('nope')).toBe(false);
  });
});
