import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import CurrencySymbol from "./CurrencySymbol";
import { DIRHAM_SYMBOL_PATH } from "@/lib/dirham-symbol";

afterEach(cleanup);

describe("CurrencySymbol", () => {
  it("renders the traced Dirham symbol for AED: an inline SVG that follows the text colour and size", () => {
    const { container } = render(<span>199.00 <CurrencySymbol code="AED" /></span>);
    const svg = screen.getByRole("img", { name: "AED" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.getAttribute("fill-rule")).toBe("evenodd");
    expect(svg.style.verticalAlign).toBe("baseline");
    expect(svg.style.height).toContain("em");
    expect(container.querySelector("path")?.getAttribute("d")).toBe(DIRHAM_SYMBOL_PATH);
  });

  it("is NOT the old hand-drawn stroke glyph (a D with a bar drawn from strokes)", () => {
    const { container } = render(<CurrencySymbol code="AED" />);
    expect(container.querySelector("svg")?.getAttribute("stroke")).toBeNull();
    expect(container.querySelectorAll("path")).toHaveLength(1);
  });

  it("renders the ISO code (no symbol component) for every other currency", () => {
    for (const code of ["KWD", "SAR", "USD"]) {
      const { container, unmount } = render(<CurrencySymbol code={code} />);
      expect(container.textContent).toBe(code);
      expect(container.querySelector("svg")).toBeNull();
      unmount();
    }
  });

  it("the admin copy of the shape is identical (the apps share no code, so this is the lock)", () => {
    const sf = fs.readFileSync(path.join(__dirname, "../lib/dirham-symbol.ts"), "utf8");
    const ad = fs.readFileSync(path.join(__dirname, "../../admin/lib/dirham-symbol.ts"), "utf8");
    expect(ad).toBe(sf);
  });
});
