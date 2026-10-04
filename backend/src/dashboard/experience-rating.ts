// Average survey rating to ONE decimal, from integer sums so there is no float
// drift: tenths = round-half-up(10 * sum / count), computed as
// floor((20 * sum + count) / (2 * count)). 4.25 -> 4.3, 4.24 -> 4.2. Ratings
// are 1..5 so the average is never negative and half-up equals half-away.
// No answers is NULL, never 0.0: "no data" must not read as "rated zero".
export function averageRatingOneDecimal(
  sum: number,
  count: number,
): number | null {
  if (!Number.isInteger(sum) || !Number.isInteger(count) || count <= 0) {
    return null;
  }
  return Math.floor((20 * sum + count) / (2 * count)) / 10;
}
