import { describe, expect, it } from "vitest";
import { addToTally, removeFromTally, tallyEntries, tallyTotal } from "./scan-tally";

describe("scan tally", () => {
  it("adds per line without mutating, and lists entries in line order", () => {
    const a = addToTally({}, 7, 1);
    const b = addToTally(addToTally(a, 3, 2), 7, 1);
    expect(a).toEqual({ 7: 1 });
    expect(tallyEntries(b)).toEqual([
      { lineId: 3, quantity: 2 },
      { lineId: 7, quantity: 2 },
    ]);
    expect(tallyTotal(b)).toBe(4);
  });

  it("removing the last unit drops the line", () => {
    expect(removeFromTally({ 7: 2 }, 7)).toEqual({ 7: 1 });
    expect(removeFromTally({ 7: 1 }, 7)).toEqual({});
    expect(removeFromTally({}, 7)).toEqual({});
  });
});
