import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportsFilterBar from "./ReportsFilterBar";
import type { Outlet, ReportsFilters } from "@/lib/types";

afterEach(cleanup);

const outlets: Outlet[] = [{ id: 1, name: "Main Branch" } as Outlet, { id: 2, name: "Downtown" } as Outlet];

function renderBar(value: ReportsFilters = {}, onChange = vi.fn()) {
  render(<ReportsFilterBar value={value} onChange={onChange} outlets={outlets} onApply={vi.fn()} />);
  return onChange;
}

describe("ReportsFilterBar — outlet/order type/status/payment mode pickers", () => {
  it("renders all 4 pickers as Comboboxes, not native selects", () => {
    renderBar();
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("selecting an outlet calls onChange with the outlet id", async () => {
    const user = userEvent.setup();
    const onChange = renderBar();

    const [outletCombobox] = screen.getAllByRole("combobox");
    await user.click(outletCombobox);
    await user.click(await screen.findByRole("option", { name: "Downtown" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ outletId: 2 }));
  });

  it("selecting an order status calls onChange with the raw status value", async () => {
    const user = userEvent.setup();
    const onChange = renderBar();

    const [, , statusCombobox] = screen.getAllByRole("combobox");
    await user.click(statusCombobox);
    await user.click(await screen.findByRole("option", { name: "confirmed" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: "confirmed" }));
  });
});

describe("ReportsFilterBar: phone layout", () => {
  it("lets the two date inputs wrap and shrink instead of widening the page", () => {
    const { container } = render(<ReportsFilterBar value={{}} onChange={vi.fn()} outlets={outlets} onApply={vi.fn()} />);
    const dates = container.querySelectorAll('input[type="date"]');
    expect(dates).toHaveLength(2);
    const group = dates[0].parentElement as HTMLElement;
    expect(group.className).toMatch(/\bflex-wrap\b/);
    expect(group.className).toMatch(/\bmax-w-full\b/);
    for (const d of dates) expect(d.className).toMatch(/\bmin-w-0\b/);
  });
});
