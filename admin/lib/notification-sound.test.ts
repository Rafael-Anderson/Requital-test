import { describe, expect, it } from "vitest";
import { diffNewOrderIds } from "./notification-sound";

describe("diffNewOrderIds", () => {
  it("returns every id on the first call — nothing has been seen yet", () => {
    const seen = new Set<number>();
    expect(diffNewOrderIds(seen, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns nothing on a second call with the exact same ids — no re-flagging", () => {
    const seen = new Set<number>([1, 2, 3]);
    expect(diffNewOrderIds(seen, [1, 2, 3])).toEqual([]);
  });

  it("returns only the genuinely new ids when some were already seen", () => {
    const seen = new Set<number>([1, 2]);
    expect(diffNewOrderIds(seen, [1, 2, 3, 4])).toEqual([3, 4]);
  });

  it("adds every fetched id to the seen set, including ones already there", () => {
    const seen = new Set<number>([1]);
    diffNewOrderIds(seen, [1, 2, 3]);
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it("an id no longer present in a later fetch stays in the seen set (no pruning) and isn't re-flagged if it reappears", () => {
    const seen = new Set<number>();
    diffNewOrderIds(seen, [1, 2]); // 1, 2 now seen
    diffNewOrderIds(seen, [2]); // 1 drops off this poll's results
    expect(diffNewOrderIds(seen, [1, 2, 3])).toEqual([3]); // 1 reappearing isn't "new"
  });

  it("is order-independent — result reflects membership, not array order", () => {
    const seen = new Set<number>([5]);
    expect(diffNewOrderIds(seen, [3, 5, 1])).toEqual([3, 1]);
  });

  it("handles an empty fetch with no error", () => {
    const seen = new Set<number>([1, 2]);
    expect(diffNewOrderIds(seen, [])).toEqual([]);
  });
});
