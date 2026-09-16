import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DateTimePicker from "./DateTimePicker";

afterEach(cleanup);

// No fake timers here (userEvent hangs when paired with them unless every
// call site threads `advanceTimers` through, and it buys nothing over just
// computing expectations from the real "now" the component itself uses).
// A relative-to-today helper keeps these deterministic regardless of when
// the suite actually runs, month-end included.
function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// A day guaranteed to (a) exist in the currently-displayed month and
// (b) not be disabled as "before today".
function futureDayInCurrentMonth(): { day: number; date: Date } {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate() < daysInMonth ? now.getDate() + 1 : now.getDate();
  return { day, date: new Date(now.getFullYear(), now.getMonth(), day) };
}

describe("DateTimePicker", () => {
  it("shows a placeholder when no value is set, and opens a calendar on click", async () => {
    const user = userEvent.setup();
    render(<DateTimePicker value={null} onChange={vi.fn()} />);

    expect(screen.getByText("Select date & time")).toBeInTheDocument();
    await user.click(screen.getByText("Select date & time"));

    expect(screen.getByText(monthLabel(new Date()))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
  });

  it("Cancel closes the popover without calling onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateTimePicker value={null} onChange={onChange} />);

    await user.click(screen.getByText("Select date & time"));
    const { day } = futureDayInCurrentMonth();
    await user.click(screen.getByRole("button", { name: String(day) }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(monthLabel(new Date()))).not.toBeInTheDocument();
  });

  it("days before today are disabled, today is not", async () => {
    const user = userEvent.setup();
    render(<DateTimePicker value={null} onChange={vi.fn()} />);
    await user.click(screen.getByText("Select date & time"));

    const now = new Date();
    expect(screen.getByRole("button", { name: String(now.getDate()) })).not.toBeDisabled();
    if (now.getDate() > 1) {
      expect(screen.getByRole("button", { name: String(now.getDate() - 1) })).toBeDisabled();
    }
  });

  it("picking a day, hour and minute then Select commits the date-time and closes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateTimePicker value={null} onChange={onChange} />);

    await user.click(screen.getByText("Select date & time"));
    const { day, date } = futureDayInCurrentMonth();
    await user.click(screen.getByRole("button", { name: String(day) }));
    await user.selectOptions(screen.getByLabelText("Hour"), "14");
    await user.selectOptions(screen.getByLabelText("Minute"), "30");
    await user.click(screen.getByRole("button", { name: "Select" }));

    const expected = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 14, 30, 0, 0).toISOString();
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(screen.queryByText(monthLabel(new Date()))).not.toBeInTheDocument();
  });

  it("navigates months with the prev/next arrows", async () => {
    const user = userEvent.setup();
    render(<DateTimePicker value={null} onChange={vi.fn()} />);
    await user.click(screen.getByText("Select date & time"));

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText(monthLabel(nextMonth))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText(monthLabel(prevMonth))).toBeInTheDocument();
  });

  it("renders an already-set value as the formatted trigger label", () => {
    render(<DateTimePicker value={new Date(2026, 8, 16, 15, 58, 0, 0).toISOString()} onChange={vi.fn()} />);
    expect(screen.getByText("09/16/2026, 15:58")).toBeInTheDocument();
  });
});
