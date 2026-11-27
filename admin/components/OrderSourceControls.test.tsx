import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import OrderSourceControls from "./OrderSourceControls";

afterEach(cleanup);

describe("OrderSourceControls", () => {
  it("defaults to All and lists every registry source, even with no orders", () => {
    render(<OrderSourceControls sources={[]} sort="newest" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Source:\s*All/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Source:/ }));
    expect(screen.getByLabelText("All")).toBeChecked();
    for (const label of ["Website", "Custom order", "Talabat", "Deliveroo"]) {
      expect(screen.getByLabelText(label)).not.toBeChecked();
    }
  });

  it("adds a source, and picking All clears the filter", () => {
    const onChange = vi.fn();
    const { rerender } = render(<OrderSourceControls sources={[]} sort="newest" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Source:/ }));
    fireEvent.click(screen.getByLabelText("Talabat"));
    expect(onChange).toHaveBeenLastCalledWith({ sources: ["talabat"], sort: "newest" });

    rerender(<OrderSourceControls sources={["talabat", "custom"]} sort="newest" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /Source:\s*2 selected/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("All"));
    expect(onChange).toHaveBeenLastCalledWith({ sources: [], sort: "newest" });
  });

  it("ticking every source is the same as All", () => {
    const onChange = vi.fn();
    render(<OrderSourceControls sources={["website", "custom", "talabat"]} sort="source" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Source:/ }));
    fireEvent.click(screen.getByLabelText("Deliveroo"));
    expect(onChange).toHaveBeenLastCalledWith({ sources: [], sort: "source" });
  });

  it("offers Source next to the default sort", () => {
    const onChange = vi.fn();
    render(<OrderSourceControls sources={["custom"]} sort="newest" onChange={onChange} />);
    const select = screen.getByLabelText("Sort orders") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["newest", "source"]);
    fireEvent.change(select, { target: { value: "source" } });
    expect(onChange).toHaveBeenLastCalledWith({ sources: ["custom"], sort: "source" });
  });
});
