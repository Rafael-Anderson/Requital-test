import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Money from "./Money";

afterEach(cleanup);

describe("Money", () => {
  it("AED: the amount (minor-unit aware, thousands separators) followed by the Dirham symbol", () => {
    const { container } = render(<Money amount="1234.5" currency="AED" />);
    expect(container.textContent).toBe("1,234.50 ");
    expect(screen.getByRole("img", { name: "AED" })).toBeInTheDocument();
  });

  it("other currencies keep the exact text formatMoney gives, KWD with its three decimals", () => {
    const { container } = render(<Money amount="10.505" currency="KWD" />);
    expect(container.textContent).toBe("10.505 KWD");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("a missing amount never prints NaN: just the symbol for AED, just the code otherwise", () => {
    const a = render(<Money amount={null} currency="AED" />);
    expect(a.container.textContent).toBe("");
    expect(a.container.querySelector("svg")).not.toBeNull();
    a.unmount();
    const b = render(<Money amount="abc" currency="SAR" />);
    expect(b.container.textContent).toBe("SAR");
  });
});
