// The draft receipt tally for a scan-driven receive (INV-3): units scanned per PO line,
// held in the browser until the user commits them through the normal receive endpoint.
export type Tally = Record<number, number>;

export function addToTally(tally: Tally, lineId: number, quantity: number): Tally {
  return { ...tally, [lineId]: (tally[lineId] ?? 0) + quantity };
}

// Takes one unit off a line; a line at zero drops out of the tally.
export function removeFromTally(tally: Tally, lineId: number): Tally {
  const next = { ...tally };
  const left = (next[lineId] ?? 0) - 1;
  if (left > 0) next[lineId] = left;
  else delete next[lineId];
  return next;
}

export function tallyEntries(tally: Tally): { lineId: number; quantity: number }[] {
  return Object.entries(tally)
    .map(([lineId, quantity]) => ({ lineId: Number(lineId), quantity }))
    .filter((e) => e.quantity > 0)
    .sort((a, b) => a.lineId - b.lineId);
}

export function tallyTotal(tally: Tally): number {
  return tallyEntries(tally).reduce((n, e) => n + e.quantity, 0);
}
