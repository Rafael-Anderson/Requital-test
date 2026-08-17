import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Toggle from "./Toggle";

// Visual-only changes (red -> neutral grey for "off"; green -> brand accent
// for "on", per the 2026-08 admin redesign — see Toggle.tsx's own comment);
// functional behavior (click toggles, aria-checked reflects state, disabled
// blocks the click) must stay identical.
describe("Toggle", () => {
  it("calls onChange with the inverted value when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange(false) when clicked while checked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={true} onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("reflects checked state via aria-checked", () => {
    const { rerender } = render(<Toggle checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    rerender(<Toggle checked={true} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("does not call onChange when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} disabled />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("off state uses a neutral grey, not red", () => {
    render(<Toggle checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch").className).not.toMatch(/bg-red/);
    expect(screen.getByRole("switch").className).toMatch(/bg-zinc/);
  });

  it("on state uses the brand accent color, not green", () => {
    render(<Toggle checked={true} onChange={() => {}} />);
    expect(screen.getByRole("switch").className).not.toMatch(/bg-green/);
    expect(screen.getByRole("switch").className).toMatch(/bg-accent/);
  });

  it("renders no tooltip when the tooltip prop is omitted", () => {
    render(<Toggle checked={false} onChange={() => {}} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("wraps the switch in a Tooltip with the given text when tooltip is set", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Toggle checked={false} onChange={onChange} tooltip="Deducts stock on every order." />,
    );
    // Tooltip.tsx portals and only mounts its content on hover/focus (not
    // unconditionally in the DOM) — see that component's own tests.
    fireEvent.mouseEnter(screen.getByRole("switch").parentElement!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Deducts stock on every order.");
    // Still fully functional as a switch, not just decorative.
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
