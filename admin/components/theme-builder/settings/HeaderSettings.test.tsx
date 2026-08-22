import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HeaderSettings from "./HeaderSettings";

// LegacyHeaderSettings pulls in useLegacyTheme (its own network fetch) —
// irrelevant to this file's own "Menu bar background" picker, stubbed out
// the same way a complex unrelated child component gets mocked elsewhere.
vi.mock("../LegacyHeaderSettings", () => ({
  default: () => null,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

describe("HeaderSettings — menu bar background", () => {
  it("renders a Menu bar background color control separate from Header background", () => {
    render(<HeaderSettings settings={{}} onUpdate={vi.fn()} />);
    expect(screen.getByText("Menu bar background")).toBeInTheDocument();
    expect(screen.getByText(/falls back to the header background above/i)).toBeInTheDocument();
  });

  it("picking a hex value in the Menu bar background swatch calls onUpdate with that key", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<HeaderSettings settings={{}} onUpdate={onUpdate} />);

    const row = screen.getByText("Menu bar background").closest("div")!;
    await user.click(within(row).getByRole("button", { name: /pick color/i }));

    const hexInput = screen.getByLabelText("Hex color value");
    await user.clear(hexInput);
    await user.type(hexInput, "#123456");
    await user.tab();

    expect(onUpdate).toHaveBeenCalledWith("menuBarBackground", "#123456");
  });

  it("does not affect the separate Header background Color picker", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<HeaderSettings settings={{}} onUpdate={onUpdate} />);

    const row = screen.getByText("Menu bar background").closest("div")!;
    await user.click(within(row).getByRole("button", { name: /pick color/i }));
    const hexInput = screen.getByLabelText("Hex color value");
    await user.clear(hexInput);
    await user.type(hexInput, "#123456");
    await user.tab();

    expect(onUpdate).not.toHaveBeenCalledWith("background", expect.anything());
  });
});
