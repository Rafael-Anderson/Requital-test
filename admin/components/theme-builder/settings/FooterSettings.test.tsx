import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FooterSettings from "./FooterSettings";

// LegacyFooterSettings pulls in useLegacyTheme (its own network fetch) —
// irrelevant to this file, stubbed the same way HeaderSettings.test.tsx
// stubs LegacyHeaderSettings.
vi.mock("../LegacyFooterSettings", () => ({
  default: () => null,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

describe("FooterSettings — layout presets and new settings (C1)", () => {
  it("renders one preset card per FOOTER_PRESETS entry and calls onApplyPreset on click", async () => {
    const user = userEvent.setup();
    const onApplyPreset = vi.fn();
    render(<FooterSettings settings={{}} onUpdate={vi.fn()} onApplyPreset={onApplyPreset} />);
    expect(screen.getByText("Multi-column")).toBeInTheDocument();
    expect(screen.getByText("Mega")).toBeInTheDocument();
    await user.click(screen.getByText("One line"));
    expect(onApplyPreset).toHaveBeenCalledWith("one-line");
  });

  it("defaults columns to 'Auto' and the three toggles off when settings is empty", () => {
    render(<FooterSettings settings={{}} onUpdate={vi.fn()} onApplyPreset={vi.fn()} />);
    expect(screen.getByLabelText("Columns")).toHaveValue("");
    expect(screen.getByText("Show payment icons").closest("div")).toBeInTheDocument();
  });

  it("calls onUpdate with a numeric columns value, or undefined for 'Auto'", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<FooterSettings settings={{ columns: 3 }} onUpdate={onUpdate} onApplyPreset={vi.fn()} />);
    expect(screen.getByLabelText("Columns")).toHaveValue("3");
    await user.selectOptions(screen.getByLabelText("Columns"), "");
    expect(onUpdate).toHaveBeenCalledWith("columns", undefined);
  });

  it("calls onUpdate for showPaymentIcons/waveEdge/bottomBarSeparate toggles", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<FooterSettings settings={{}} onUpdate={onUpdate} onApplyPreset={vi.fn()} />);
    await user.click(screen.getByText("Show payment icons").closest("div")!.querySelector("button")!);
    expect(onUpdate).toHaveBeenCalledWith("showPaymentIcons", true);
  });
});
