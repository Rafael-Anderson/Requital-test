import { describe, expect, it } from "vitest";
import {
  ORDER_SOURCES,
  parseSortParam,
  parseSourcesParam,
  showsSourceTag,
  withSourceParams,
} from "./order-sources";

describe("order sources", () => {
  it("lists Website, Custom order, Talabat and Deliveroo", () => {
    expect(ORDER_SOURCES.map((s) => s.label)).toEqual(["Website", "Custom order", "Talabat", "Deliveroo"]);
  });

  it("tags every source except Website", () => {
    expect(showsSourceTag("website")).toBe(false);
    expect(showsSourceTag("custom")).toBe(true);
    expect(showsSourceTag("talabat")).toBe(true);
    expect(showsSourceTag("deliveroo")).toBe(true);
    expect(showsSourceTag(null)).toBe(false);
    expect(showsSourceTag("nope")).toBe(false);
  });

  it("reads the URL: nothing is All and Newest first, unknown keys are dropped", () => {
    expect(parseSourcesParam(null)).toEqual([]);
    expect(parseSourcesParam("")).toEqual([]);
    expect(parseSourcesParam("deliveroo,careem,custom")).toEqual(["custom", "deliveroo"]);
    expect(parseSortParam(null)).toBe("newest");
    expect(parseSortParam("source")).toBe("source");
    expect(parseSortParam("total")).toBe("newest");
  });

  it("writes the URL, keeping other params and dropping the defaults", () => {
    const base = new URLSearchParams("orderId=7");
    expect(withSourceParams(base, ["talabat", "custom"], "source").toString()).toBe(
      "orderId=7&sources=custom%2Ctalabat&sort=source",
    );
    const cleared = withSourceParams(new URLSearchParams("orderId=7&sources=custom&sort=source"), [], "newest");
    expect(cleared.toString()).toBe("orderId=7");
  });
});
