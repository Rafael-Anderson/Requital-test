// ANL-8's arithmetic, kept pure for the same reason rollup.ts is: the edge
// cases here (nothing sold, nothing in stock, a product that has never been
// stocked at all) are where an inventory report quietly lies, and they are
// worth testing without a database.

export interface ProductMovementInput {
  productId: number;
  name: string;
  // Units sold over the window, summed from dailyproductmetrics.
  unitsSold: number;
  // Current on-hand stock. NULL means "not stocked here at all", which is a
  // different statement from a real zero - a recipe-backed product has no
  // shadow ingredient row to read, and so has no stock figure rather than an
  // empty one.
  stockOnHand: number | null;
  // Days since the last day this product moved, or null if it has never moved
  // inside the window being examined.
  daysSinceLastSale: number | null;
}

export interface ProductMovementMetrics {
  productId: number;
  name: string;
  unitsSold: number;
  stockOnHand: number | null;
  // unitsSold / (unitsSold + stockOnHand), as a percentage. Null when there is
  // no stock figure to compare against - a sell-through of "100%" for a product
  // whose stock is simply unknown would be an invented number.
  sellThroughPercent: number | null;
  // stockOnHand / average daily units. Null when nothing sold (cover is not
  // zero, it is unbounded) or when there is no stock figure.
  daysOfCover: number | null;
  daysSinceLastSale: number | null;
  isDeadStock: boolean;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// `windowDays` is how many days of sales `unitsSold` covers - needed for the
// daily average behind days-of-cover, and meaningless to infer from the data.
//
// `deadStockAfterDays` is the "no movement in N days" threshold. A product is
// dead stock only if it still HAS stock: something with nothing on hand and no
// sales is discontinued, not dead capital, and listing it would bury the rows a
// merchant can actually act on.
export function computeMovementMetrics(
  rows: readonly ProductMovementInput[],
  windowDays: number,
  deadStockAfterDays: number,
): ProductMovementMetrics[] {
  const days = Math.max(1, windowDays);

  return rows.map((row) => {
    const stock = row.stockOnHand;
    const sold = Math.max(0, row.unitsSold);

    let sellThroughPercent: number | null = null;
    if (stock !== null) {
      const denominator = sold + stock;
      // Nothing sold and nothing in stock is 0% rather than a divide by zero:
      // the product demonstrably did not sell through.
      sellThroughPercent = denominator === 0 ? 0 : round1((sold / denominator) * 100);
    }

    let daysOfCover: number | null = null;
    if (stock !== null && sold > 0) {
      const perDay = sold / days;
      daysOfCover = round1(stock / perDay);
    }

    // Never sold inside the window counts as dead once it has been examined for
    // long enough, which is what a null daysSinceLastSale means here.
    const stale =
      row.daysSinceLastSale === null || row.daysSinceLastSale >= deadStockAfterDays;

    return {
      productId: row.productId,
      name: row.name,
      unitsSold: sold,
      stockOnHand: stock,
      sellThroughPercent,
      daysOfCover,
      daysSinceLastSale: row.daysSinceLastSale,
      isDeadStock: stale && stock !== null && stock > 0,
    };
  });
}

// Worst cover first: the rows a merchant needs to act on are the ones about to
// run out. Products with no cover figure sort last rather than first - "unknown"
// is not "urgent", and putting them at the top would bury the real stockouts.
export function sortByUrgency(
  rows: readonly ProductMovementMetrics[],
): ProductMovementMetrics[] {
  return [...rows].sort((a, b) => {
    if (a.daysOfCover === null && b.daysOfCover === null) {
      return b.unitsSold - a.unitsSold;
    }
    if (a.daysOfCover === null) return 1;
    if (b.daysOfCover === null) return -1;
    return a.daysOfCover - b.daysOfCover;
  });
}
