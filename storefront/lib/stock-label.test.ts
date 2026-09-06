import { describe, expect, it } from "vitest";
import { stockLabel } from "./stock-label";

describe("stockLabel", () => {
  it("null ⇒ In stock / ok", () => {
    expect(stockLabel(null)).toEqual({ text: "In stock", tone: "ok" });
  });
  it("<= 0 ⇒ Out of stock / out", () => {
    expect(stockLabel(0)).toEqual({ text: "Out of stock", tone: "out" });
    expect(stockLabel(-2)).toEqual({ text: "Out of stock", tone: "out" });
  });
  it("1..5 ⇒ Only N left / low", () => {
    expect(stockLabel(1)).toEqual({ text: "Only 1 left", tone: "low" });
    expect(stockLabel(5)).toEqual({ text: "Only 5 left", tone: "low" });
  });
  it("> 5 ⇒ In stock / ok", () => {
    expect(stockLabel(6)).toEqual({ text: "In stock", tone: "ok" });
    expect(stockLabel(999)).toEqual({ text: "In stock", tone: "ok" });
  });
});
