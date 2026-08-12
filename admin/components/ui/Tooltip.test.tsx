import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Tooltip from "./Tooltip";

// jsdom has no real layout engine — getBoundingClientRect() returns an
// all-zero rect by default, which would spuriously trigger the top-overflow
// flip (see Tooltip.tsx's resolveSide) on every test. Mocked here to a
// plausible trigger position well within the viewport, matching what a real
// browser would report for an element that isn't near any edge.
function mockTriggerRect(overrides: Partial<DOMRect> = {}) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 300,
    bottom: 320,
    left: 300,
    right: 340,
    width: 40,
    height: 20,
    x: 300,
    y: 300,
    toJSON: () => "",
    ...overrides,
  });
}

describe("Tooltip", () => {
  beforeEach(() => {
    mockTriggerRect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always renders the trigger", () => {
    render(
      <Tooltip label="Delete this item">
        <button>X</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "X" })).toBeInTheDocument();
  });

  it("is not mounted until hovered or focused, then appears — portaled to document.body, not nested under the trigger", () => {
    const { container } = render(
      <Tooltip label="Delete this item">
        <button>X</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "X" }).parentElement!);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Delete this item");
    // Portaled directly onto document.body — not a descendant of the
    // component's own render container, which is what makes it escape an
    // ancestor's overflow clipping (Table.tsx's scroll wrapper, etc.).
    expect(container.contains(tooltip)).toBe(false);
    expect(document.body.contains(tooltip)).toBe(true);
  });

  it("hides on mouse leave and on blur", () => {
    render(
      <Tooltip label="Delete this item">
        <button>X</button>
      </Tooltip>,
    );
    const wrapper = screen.getByRole("button", { name: "X" }).parentElement!;

    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.focus(wrapper);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(wrapper);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("wires aria-describedby on the wrapper to the tooltip's id", () => {
    const { container } = render(
      <Tooltip label="Delete this item">
        <button>X</button>
      </Tooltip>,
    );
    const wrapper = container.querySelector("[aria-describedby]")!;
    fireEvent.mouseEnter(wrapper);
    const tooltip = screen.getByRole("tooltip");
    expect(wrapper.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("renders only the children, no tooltip element even on hover, when disabled", () => {
    const { container } = render(
      <Tooltip label="Delete this item" disabled>
        <button>X</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(container.querySelector("button")!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "X" })).toBeInTheDocument();
  });

  it("caps width at 220px and wraps/breaks long words, instead of a single unbounded nowrap line", () => {
    render(
      <Tooltip label="Delete this item">
        <button>X</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "X" }).parentElement!);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("max-w-[220px]");
    expect(tooltip.className).toContain("break-words");
    expect(tooltip.className).toContain("whitespace-normal");
    expect(tooltip.className).not.toContain("whitespace-nowrap");
  });

  it("sets a z-index above every other overlay in the app (modals/dropdowns/toasts at z-50, NavigationProgress at 9999)", () => {
    render(
      <Tooltip label="Delete this item">
        <button>X</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "X" }).parentElement!);
    const tooltip = screen.getByRole("tooltip");
    expect(Number(tooltip.style.zIndex)).toBeGreaterThan(9999);
  });

  it("positions bottom/center below and centered on the trigger by default", () => {
    render(
      <Tooltip label="Default position">
        <button>X</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole("button", { name: "X" }).parentElement!);
    const tooltip = screen.getByRole("tooltip");
    // top=300, left=300, width=40 -> center is 320; side="top" default with
    // plenty of headroom (top: 300) should NOT flip.
    expect(tooltip.style.top).toBe("292px"); // rect.top(300) - GAP(8)
    expect(tooltip.style.left).toBe("320px"); // rect.left(300) + width/2(20)
    expect(tooltip.style.transform).toBe("translate(-50%, -100%)");
  });

  it("respects an explicit side/align", () => {
    render(
      <Tooltip label="Aligned end" side="bottom" align="end">
        <button>X</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole("button", { name: "X" }).parentElement!);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.style.top).toBe("328px"); // rect.bottom(320) + GAP(8)
    expect(tooltip.style.left).toBe("340px"); // rect.right
    expect(tooltip.style.transform).toBe("translate(-100%, 0)");
  });

  it("flips side=\"top\" to bottom when the trigger is too close to the viewport's top edge", () => {
    mockTriggerRect({ top: 10, bottom: 30 });
    render(
      <Tooltip label="Near the header">
        <button>X</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "X" }).parentElement!);
    const tooltip = screen.getByRole("tooltip");
    // Flipped: anchored below the trigger (rect.bottom + GAP), not above it.
    expect(tooltip.style.top).toBe("38px");
    expect(tooltip.style.transform).toBe("translate(-50%, 0)");
  });
});
