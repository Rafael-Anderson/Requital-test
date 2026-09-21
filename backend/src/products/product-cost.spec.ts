import { resolveUnitCost } from './product-cost';

describe('resolveUnitCost', () => {
  describe('plain product (usesIngredients false)', () => {
    it("uses the product's own costPrice", () => {
      expect(
        resolveUnitCost({
          usesIngredients: false,
          costPrice: '12.50',
          recipe: [],
        }),
      ).toBe('12.50');
    });

    it('normalises to 2dp so the DECIMAL column does not store a float tail', () => {
      expect(
        resolveUnitCost({
          usesIngredients: false,
          costPrice: '12.5',
          recipe: [],
        }),
      ).toBe('12.50');
    });

    // Most merchants have never filled cost in. Unknown must stay unknown:
    // a 0 here reports the whole line as 100% margin.
    it('is null, not zero, when no cost is set', () => {
      expect(
        resolveUnitCost({
          usesIngredients: false,
          costPrice: null,
          recipe: [],
        }),
      ).toBeNull();
    });

    it('ignores any recipe rows that happen to exist', () => {
      expect(
        resolveUnitCost({
          usesIngredients: false,
          costPrice: '5.00',
          recipe: [
            { ingredientId: 1, quantityPerUnit: 10, costPerUnit: '99.00' },
          ],
        }),
      ).toBe('5.00');
    });
  });

  describe('recipe-backed product (usesIngredients true)', () => {
    it('sums quantityPerUnit x costPerUnit across the recipe', () => {
      expect(
        resolveUnitCost({
          usesIngredients: true,
          costPrice: '999.00', // deliberately wrong; the recipe is the truth
          recipe: [
            { ingredientId: 1, quantityPerUnit: 12, costPerUnit: '1.25' }, // 15.00
            { ingredientId: 2, quantityPerUnit: 1, costPerUnit: '3.50' }, //  3.50
            { ingredientId: 3, quantityPerUnit: 0.5, costPerUnit: '4.00' }, //  2.00
          ],
        }),
      ).toBe('20.50');
    });

    // One uncosted ingredient makes the whole line's cost unknowable. Summing
    // it as 0 would quietly understate cost and overstate margin, which is
    // worse than reporting nothing.
    it('is null when any ingredient has no costPerUnit', () => {
      expect(
        resolveUnitCost({
          usesIngredients: true,
          costPrice: null,
          recipe: [
            { ingredientId: 1, quantityPerUnit: 2, costPerUnit: '1.00' },
            { ingredientId: 2, quantityPerUnit: 1, costPerUnit: null },
          ],
        }),
      ).toBeNull();
    });

    it('is null for a recipe product with no recipe rows', () => {
      expect(
        resolveUnitCost({
          usesIngredients: true,
          costPrice: '10.00',
          recipe: [],
        }),
      ).toBeNull();
    });

    it('is null rather than NaN on an unparseable value', () => {
      expect(
        resolveUnitCost({
          usesIngredients: true,
          costPrice: null,
          recipe: [
            { ingredientId: 1, quantityPerUnit: 1, costPerUnit: 'not-a-number' },
          ],
        }),
      ).toBeNull();
    });
  });

  // The whole reason this is captured at order time rather than read at
  // report time: the same product ordered before and after a cost change must
  // yield two different captured costs, and the earlier one must not move.
  it('reflects the cost as it stood at the moment of capture', () => {
    const before = resolveUnitCost({
      usesIngredients: false,
      costPrice: '10.00',
      recipe: [],
    });
    const after = resolveUnitCost({
      usesIngredients: false,
      costPrice: '14.00',
      recipe: [],
    });
    expect(before).toBe('10.00');
    expect(after).toBe('14.00');
    expect(before).not.toBe(after);
  });

  it('reflects a recipe edit the same way', () => {
    const recipe = [
      { ingredientId: 1, quantityPerUnit: 2, costPerUnit: '3.00' },
    ];
    expect(resolveUnitCost({ usesIngredients: true, costPrice: null, recipe })).toBe(
      '6.00',
    );
    expect(
      resolveUnitCost({
        usesIngredients: true,
        costPrice: null,
        recipe: [{ ingredientId: 1, quantityPerUnit: 3, costPerUnit: '3.00' }],
      }),
    ).toBe('9.00');
  });
});
