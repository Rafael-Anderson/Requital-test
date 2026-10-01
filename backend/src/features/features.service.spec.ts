import { planDefault, resolveFlag } from './features.service';
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

  it('a column-backed key falls to plan then registry default only when the column is NULL', () => {
    expect(resolveFlag(columnDef, undefined, null, true)).toBe(true);
    expect(
      resolveFlag({ ...columnDef, default: true }, undefined, null, undefined),
    ).toBe(true);
  });

  it('a table-backed key ignores any column value and uses override, plan, default', () => {
    expect(resolveFlag(tableDef, undefined, false, undefined)).toBe(true);
    expect(resolveFlag(tableDef, undefined, undefined, false)).toBe(false);
    expect(resolveFlag(tableDef, false, undefined, true)).toBe(false);
  });

  it('planDefault has no opinion until billing exists', () => {
    expect(planDefault(1, 'slider')).toBeUndefined();
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
