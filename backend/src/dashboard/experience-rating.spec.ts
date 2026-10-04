import { averageRatingOneDecimal } from './experience-rating';

describe('averageRatingOneDecimal', () => {
  it('is null (never 0) when there are no answers', () => {
    expect(averageRatingOneDecimal(0, 0)).toBeNull();
    expect(averageRatingOneDecimal(5, 0)).toBeNull();
  });

  it('rounds half up to one decimal from integer sums', () => {
    expect(averageRatingOneDecimal(17, 4)).toBe(4.3); // 4.25
    expect(averageRatingOneDecimal(21, 5)).toBe(4.2); // 4.2
    expect(averageRatingOneDecimal(13, 3)).toBe(4.3); // 4.333
    expect(averageRatingOneDecimal(14, 3)).toBe(4.7); // 4.666
    expect(averageRatingOneDecimal(9, 2)).toBe(4.5); // exact
    expect(averageRatingOneDecimal(4, 1)).toBe(4);
    expect(averageRatingOneDecimal(1, 1)).toBe(1);
    expect(averageRatingOneDecimal(5, 1)).toBe(5);
  });

  it('does not drift on a large count where a float mean would', () => {
    // 2 * 10^6 answers averaging exactly 4.05 round half up to 4.1; one
    // rating fewer is just under the half and rounds down.
    expect(averageRatingOneDecimal(8_100_000, 2_000_000)).toBe(4.1);
    expect(averageRatingOneDecimal(8_099_999, 2_000_000)).toBe(4);
  });

  it('rejects non-integer inputs rather than guessing', () => {
    expect(averageRatingOneDecimal(4.5, 2)).toBeNull();
    expect(averageRatingOneDecimal(4, 1.5)).toBeNull();
  });
});
