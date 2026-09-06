import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { useAnimatedNumber } from "./use-animated-number";

let reduced = false;
vi.mock("./use-reduced-motion", () => ({ useReducedMotion: () => reduced }));

afterEach(() => {
  cleanup();
  reduced = false;
});

function Probe({ value, enabled }: { value: number; enabled?: boolean }) {
  return createElement("span", { "data-testid": "n" }, useAnimatedNumber(value, enabled).toFixed(2));
}

describe("useAnimatedNumber (§8.13.C item 13)", () => {
  it("returns the value verbatim on first render", () => {
    const { getByTestId } = render(createElement(Probe, { value: 42 }));
    expect(getByTestId("n").textContent).toBe("42.00");
  });

  it("returns the value verbatim when disabled, even after it changes", () => {
    const { getByTestId, rerender } = render(createElement(Probe, { value: 10, enabled: false }));
    rerender(createElement(Probe, { value: 99, enabled: false }));
    expect(getByTestId("n").textContent).toBe("99.00");
  });

  it("returns the value verbatim under reduced motion", () => {
    reduced = true;
    const { getByTestId, rerender } = render(createElement(Probe, { value: 10, enabled: true }));
    rerender(createElement(Probe, { value: 99, enabled: true }));
    expect(getByTestId("n").textContent).toBe("99.00");
  });
});
