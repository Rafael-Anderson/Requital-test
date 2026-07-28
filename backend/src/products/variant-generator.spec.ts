import { comboKey, generateVariantCombinations } from './variant-generator';

describe('generateVariantCombinations', () => {
  it('returns nothing for zero options', () => {
    expect(generateVariantCombinations([])).toEqual([]);
  });

  it('single option produces one combo per value, padded with nulls', () => {
    expect(generateVariantCombinations([[1, 2, 3]])).toEqual([
      [1, null, null],
      [2, null, null],
      [3, null, null],
    ]);
  });

  it('two options produce the full cartesian product (3 sizes x 2 colors = 6)', () => {
    const combos = generateVariantCombinations([
      [1, 2, 3],
      [10, 11],
    ]);
    expect(combos).toHaveLength(6);
    expect(combos).toEqual([
      [1, 10, null],
      [1, 11, null],
      [2, 10, null],
      [2, 11, null],
      [3, 10, null],
      [3, 11, null],
    ]);
  });

  it('three options multiply all three dimensions', () => {
    const combos = generateVariantCombinations([[1, 2], [10], [100, 101]]);
    expect(combos).toHaveLength(4);
    expect(combos).toEqual([
      [1, 10, 100],
      [1, 10, 101],
      [2, 10, 100],
      [2, 10, 101],
    ]);
  });
});

describe('comboKey', () => {
  it('is stable and distinguishes different combos', () => {
    expect(comboKey([1, 2, null])).toBe(comboKey([1, 2, null]));
    expect(comboKey([1, 2, null])).not.toBe(comboKey([1, 2, 3]));
    expect(comboKey([1, null, null])).not.toBe(comboKey([null, 1, null]));
  });
});
