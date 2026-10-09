import { describe, expect, it } from "vitest";
import { describeNode, depthOf, fromPayload, isComplete, newGroup, newLeaf, toPayload } from "./segment-rules";

describe("segment rules (admin)", () => {
  it("builds the wire shape with typed values", () => {
    expect(toPayload({ ...newLeaf("orderCount"), cmp: "gte", value: "3" })).toEqual({ field: "orderCount", cmp: "gte", value: 3 });
    expect(toPayload({ ...newLeaf("lifetimeSpend"), value: "10.505", currency: "KWD" })).toEqual({
      field: "lifetimeSpend",
      cmp: "eq",
      value: "10.505",
      currency: "KWD",
    });
    expect(toPayload(newLeaf("newsletterSubscriber"))).toEqual({ field: "newsletterSubscriber", cmp: "is", value: true });
    expect(toPayload(newLeaf("consent"))).toEqual({ field: "consent", cmp: "is", channel: "email", value: "granted" });
  });

  it("round-trips a tree", () => {
    const tree = { op: "or", rules: [{ field: "tag", cmp: "has", value: 4 }, { op: "and", rules: [{ field: "orderCount", cmp: "eq", value: 0 }] }] };
    expect(toPayload(fromPayload(tree))).toEqual(tree);
  });

  it("is incomplete until every value is filled in", () => {
    const g = newGroup();
    expect(isComplete(g)).toBe(false);
    (g.rules[0] as { value: string }).value = "2";
    expect(isComplete(g)).toBe(true);
    expect(depthOf(g)).toBe(1);
  });

  it("words a rule for the list", () => {
    expect(describeNode({ ...newLeaf("tag"), value: "4" }, () => "VIP")).toBe('Tag has "VIP"');
    expect(describeNode({ ...newLeaf("consent"), value: "unknown" }, () => "")).toBe("email consent not asked");
  });
});
