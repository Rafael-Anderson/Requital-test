import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ColorPicker from "./ColorPicker";

// Covers the follow-up PR's "custom in-app picker" requirement: theme-scheme
// preset swatches, and a recent-colours history persisted to localStorage
// (so no OS colour dialog is ever involved).
beforeEach(() => localStorage.clear());

const PRESETS = [
  { label: "Main button", value: "#3355ff" },
  { label: "Main text", value: "#111111" },
];

async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /pick color/i }));
}

describe("ColorPicker", () => {
  it("renders theme preset swatches and commits one on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} presets={PRESETS} />);

    await openPopover(user);
    await user.click(screen.getByRole("button", { name: "Main button" }));
    expect(onChange).toHaveBeenCalledWith("#3355ff");
  });

  it("has no preset row when presets are absent", async () => {
    const user = userEvent.setup();
    render(<ColorPicker value="#000000" onChange={vi.fn()} />);
    await openPopover(user);
    expect(screen.queryByText("Theme colors")).not.toBeInTheDocument();
  });

  it("persists a picked colour to the recent list and shows it on reopen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<ColorPicker value="#000000" onChange={onChange} presets={PRESETS} />);

    await openPopover(user);
    await user.click(screen.getByRole("button", { name: "Main text" }));
    expect(JSON.parse(localStorage.getItem("requital_admin_recent_colors")!)).toContain("#111111");

    // Close, reopen (value prop reflects the committed pick) — Recent row is now present.
    await user.keyboard("{Escape}");
    rerender(<ColorPicker value="#111111" onChange={onChange} presets={PRESETS} />);
    await openPopover(user);
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });
});
