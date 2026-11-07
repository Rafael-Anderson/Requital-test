import { describe, expect, it } from "vitest";
import { RULE_ATTRIBUTES, isRuleComplete, newRule, ruleSummary } from "./collection-rules";

describe("collection rule helpers", () => {
  it("offers exactly the supported attributes", () => {
    expect(RULE_ATTRIBUTES.map((a) => a.field).sort()).toEqual(
      [
        "category", "compare_at_price", "price", "product_type", "status",
        "stock", "tag", "title", "variant_title", "vendor", "weight",
      ].sort(),
    );
  });
  it("text attributes get the six text operators, numbers get four", () => {
    expect(RULE_ATTRIBUTES.find((a) => a.field === "title")?.operators).toHaveLength(6);
    expect(RULE_ATTRIBUTES.find((a) => a.field === "price")?.operators).toEqual(["eq", "neq", "gt", "lt"]);
  });
  it("a condition is complete only with a valid value", () => {
    expect(isRuleComplete({ field: "title", operator: "contains", value: "" })).toBe(false);
    expect(isRuleComplete({ field: "title", operator: "contains", value: "rose" })).toBe(true);
    expect(isRuleComplete({ field: "price", operator: "gt", value: "10.5" })).toBe(true);
    expect(isRuleComplete({ field: "price", operator: "gt", value: "ten" })).toBe(false);
    expect(isRuleComplete({ field: "stock", operator: "lt", value: "1.5" })).toBe(false);
    expect(isRuleComplete({ field: "compare_at_price", operator: "is_set" })).toBe(true);
  });
  it("describes a condition without an em dash", () => {
    const text = ruleSummary({ field: "price", operator: "gt", value: "10" });
    expect(text).toBe("Price is greater than 10");
    expect(text).not.toContain("—");
    expect(newRule("status").value).toBe("Available");
  });
});
