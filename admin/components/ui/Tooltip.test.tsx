import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Tooltip from "./Tooltip";

describe("Tooltip", () => {
  it("always renders the trigger", () => {
    render(
      <Tooltip label="Delete this item">
        <button>X</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "X" })).toBeInTheDocument();
  });

  it("renders the tooltip text in the DOM (CSS-hidden, not conditionally mounted)", () => {
    render(
      <Tooltip label="Delete this item">
        <button>X</button>
      </Tooltip>,
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("Delete this item");
  });

  it("wires aria-describedby on the wrapper to the tooltip's id", () => {
    const { container } = render(
      <Tooltip label="Delete this item">
        <button>X</button>
      </Tooltip>,
    );
    const wrapper = container.querySelector("[aria-describedby]");
    const tooltip = screen.getByRole("tooltip");
    expect(wrapper?.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("renders only the children, no tooltip element, when disabled", () => {
    render(
      <Tooltip label="Delete this item" disabled>
        <button>X</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "X" })).toBeInTheDocument();
  });

  it("applies the requested side/align position classes", () => {
    render(
      <Tooltip label="Aligned end" side="bottom" align="end">
        <button>X</button>
      </Tooltip>,
    );
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("top-full");
    expect(tooltip.className).toContain("right-0");
  });

  it("defaults to top/center positioning", () => {
    render(
      <Tooltip label="Default position">
        <button>X</button>
      </Tooltip>,
    );
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("bottom-full");
    expect(tooltip.className).toContain("left-1/2");
  });
});
