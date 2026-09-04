import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MotionSettings from "./MotionSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

function makeEditor(motion: Record<string, unknown> | undefined): ThemeEditorState {
  return {
    config: { globalSettings: { motion } },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

describe("MotionSettings", () => {
  it("renders with intensity at 'Default' when motion is an empty object", () => {
    render(<MotionSettings editor={makeEditor({})} />);
    const select = screen.getByLabelText("Motion intensity") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("renders without crashing when motion is undefined (pre-backfill theme)", () => {
    render(<MotionSettings editor={makeEditor(undefined)} />);
    expect(screen.getByLabelText("Motion intensity")).toBeInTheDocument();
  });

  it("picking an intensity writes it through updateGlobalSettingsCategory('motion', …)", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({});
    render(<MotionSettings editor={editor} />);
    await user.selectOptions(screen.getByLabelText("Motion intensity"), "expressive");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("motion", { intensity: "expressive" });
  });

  it("choosing 'Default' writes intensity: undefined (the true no-op)", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ intensity: "standard" });
    render(<MotionSettings editor={editor} />);
    await user.selectOptions(screen.getByLabelText("Motion intensity"), "");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("motion", { intensity: undefined });
  });

  it("does not expose scrollMotion / hoverMotion / smoothScroll (no consumer in Phase A)", () => {
    render(<MotionSettings editor={makeEditor({ intensity: "standard" })} />);
    expect(screen.queryByText(/scroll-triggered entrances/i)).toBeNull();
    expect(screen.queryByText(/hover micro-interactions/i)).toBeNull();
    expect(screen.queryByText(/smooth scroll/i)).toBeNull();
  });
});
