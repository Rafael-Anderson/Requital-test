import { describe, expect, it } from "vitest";
import {
  cardDensity,
  cardTextAlignClass,
  resolveCardAspectClass,
  resolveCardStyleClass,
} from "./product-card-style";

describe("resolveCardAspectClass", () => {
  it("undefined / null / unknown ⇒ aspect-square (today's default)", () => {
    expect(resolveCardAspectClass(undefined)).toBe("aspect-square");
    expect(resolveCardAspectClass(null)).toBe("aspect-square");
    expect(resolveCardAspectClass("weird")).toBe("aspect-square");
  });
  it("known aspects", () => {
    expect(resolveCardAspectClass("square")).toBe("aspect-square");
    expect(resolveCardAspectClass("portrait")).toBe("aspect-[3/4]");
    expect(resolveCardAspectClass("landscape")).toBe("aspect-[4/3]");
    expect(resolveCardAspectClass("tall")).toBe("aspect-[2/3]");
  });
});

describe("resolveCardStyleClass", () => {
  it("undefined / unknown ⇒ '' (minimal — today's default)", () => {
    expect(resolveCardStyleClass(undefined)).toBe("");
    expect(resolveCardStyleClass("nope")).toBe("");
    expect(resolveCardStyleClass("minimal")).toBe("");
  });

  it("bordered / shadowed keep their exact class set (radius via .theme-round-md, + p-2)", () => {
    // pre-B1: "border border-stroke rounded-lg p-2" / "rounded-lg p-2 shadow-sm shadow-black/10"
    expect(resolveCardStyleClass("bordered", "comfortable")).toBe("border border-stroke theme-round-md p-2");
    expect(resolveCardStyleClass("shadowed", "comfortable")).toBe("theme-round-md shadow-sm shadow-black/10 p-2");
    // density undefined behaves as comfortable
    expect(resolveCardStyleClass("shadowed")).toBe("theme-round-md shadow-sm shadow-black/10 p-2");
  });

  it("compact tightens padding for padded styles; minimal/overlay stay padless", () => {
    expect(resolveCardStyleClass("bordered", "compact")).toBe("border border-stroke theme-round-md p-1");
    expect(resolveCardStyleClass("polaroid", "compact")).toBe("theme-round-sm bg-background shadow-sm shadow-black/10 p-1 pb-3");
    expect(resolveCardStyleClass("polaroid", "comfortable")).toBe("theme-round-sm bg-background shadow-sm shadow-black/10 p-2 pb-4");
    expect(resolveCardStyleClass("minimal", "compact")).toBe("");
    expect(resolveCardStyleClass("overlay", "compact")).toBe("theme-round-md overflow-hidden relative");
  });

  it("new styles resolve", () => {
    expect(resolveCardStyleClass("elevated")).toContain("shadow-md");
    expect(resolveCardStyleClass("filled")).toContain("bg-black/[0.03]");
    expect(resolveCardStyleClass("outlined-hover")).toContain("hover:border-stroke");
  });
});

describe("cardDensity", () => {
  it("undefined / comfortable ⇒ today's values", () => {
    expect(cardDensity(undefined)).toEqual({ nameMargin: "mt-3", showExcerpt: true });
    expect(cardDensity("comfortable")).toEqual({ nameMargin: "mt-3", showExcerpt: true });
  });
  it("compact ⇒ tighter margin + excerpt suppressed", () => {
    expect(cardDensity("compact")).toEqual({ nameMargin: "mt-2", showExcerpt: false });
  });
});

describe("cardTextAlignClass", () => {
  it("undefined / left ⇒ '' ; center ⇒ text-center", () => {
    expect(cardTextAlignClass(undefined)).toBe("");
    expect(cardTextAlignClass("left")).toBe("");
    expect(cardTextAlignClass("center")).toBe("text-center");
  });
});
