import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Pagination, { pageWindow } from "./Pagination";

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof Pagination>> = {}) {
  const props = {
    page: 1,
    pageSize: 20,
    total: 45,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onShowAll: vi.fn(),
    noun: "products",
    ...over,
  };
  render(<Pagination {...props} />);
  return props;
}

describe("Pagination", () => {
  it("shows the range and total: 1-20 of 45", () => {
    setup();
    expect(screen.getByText("1-20 of 45")).toBeInTheDocument();
  });

  it("the last page shows the partial range", () => {
    setup({ page: 3 });
    expect(screen.getByText("41-45 of 45")).toBeInTheDocument();
  });

  it("Previous is disabled on page 1 and Next moves forward", () => {
    const p = setup();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(p.onPageChange).toHaveBeenCalledWith(2);
  });

  it("Next is disabled on the last page and Previous moves back", () => {
    const p = setup({ page: 3 });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(p.onPageChange).toHaveBeenCalledWith(2);
  });

  it("numbers every page, marks the current one and jumps on click", () => {
    const p = setup({ page: 2 });
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(p.onPageChange).toHaveBeenCalledWith(3);
  });

  it("offers 20, 50 and 100 per page and reports the choice", () => {
    const p = setup();
    const select = screen.getByLabelText("Per page") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["20", "50", "100"]);
    fireEvent.change(select, { target: { value: "50" } });
    expect(p.onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("Show all is its own button, separate from the pager", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(p.onShowAll).toHaveBeenCalled();
    expect(p.onPageChange).not.toHaveBeenCalled();
  });

  it("while showing all there is no pager and a way back to pages", () => {
    setup({ showingAll: true });
    expect(screen.getByText("Showing all 45 products")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByLabelText("Per page")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to pages" })).toBeInTheDocument();
  });

  it("a single page has no pager but still the per-page choice", () => {
    setup({ total: 5 });
    expect(screen.getByText("1-5 of 5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("an empty list says 0", () => {
    setup({ total: 0 });
    expect(screen.getByText("0 products")).toBeInTheDocument();
  });

  it("omits Show all when the list does not offer it", () => {
    setup({ onShowAll: undefined });
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });
});

describe("pageWindow", () => {
  it("lists every page when there are few", () => {
    expect(pageWindow(2, 3)).toEqual([1, 2, 3]);
  });
  it("keeps the first, last, current and neighbours with gaps between", () => {
    expect(pageWindow(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageWindow(1, 20)).toEqual([1, 2, "gap", 20]);
    expect(pageWindow(20, 20)).toEqual([1, "gap", 19, 20]);
  });
});
