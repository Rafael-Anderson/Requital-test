import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DensitySettings from "./DensitySettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

function makeEditor(density: Record<string, unknown> | undefined): ThemeEditorState {
  return {
    config: { globalSettings: { density } },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

describe("DensitySettings", () => {
  it("renders without crashing when density is undefined (pre-backfill theme)", () => {
    render(<DensitySettings editor={makeEditor(undefined)} />);
    expect(screen.getByRole("button", { name: "Default" })).toBeInTheDocument();
  });

  it("picking a preset writes it through updateGlobalSettingsCategory('density', …)", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({});
    render(<DensitySettings editor={editor} />);
    await user.click(screen.getByRole("button", { name: "Spacious" }));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("density", { preset: "spacious" });
  });

  it("choosing 'Default' writes preset: undefined (the true no-op)", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ preset: "compact" });
    render(<DensitySettings editor={editor} />);
    await user.click(screen.getByRole("button", { name: "Default" }));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("density", { preset: undefined });
  });
});
