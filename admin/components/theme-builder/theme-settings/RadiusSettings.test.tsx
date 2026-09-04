import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RadiusSettings from "./RadiusSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

function makeEditor(radius: Record<string, unknown> | undefined): ThemeEditorState {
  return {
    config: { globalSettings: { radius } },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

describe("RadiusSettings", () => {
  it("renders without crashing when radius is undefined (pre-backfill theme)", () => {
    render(<RadiusSettings editor={makeEditor(undefined)} />);
    expect(screen.getByRole("button", { name: "Default" })).toBeInTheDocument();
  });

  it("picking a preset writes it through updateGlobalSettingsCategory('radius', …)", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({});
    render(<RadiusSettings editor={editor} />);
    await user.click(screen.getByRole("button", { name: "Soft" }));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("radius", { preset: "soft" });
  });

  it("choosing 'Default' writes preset: undefined (the true no-op)", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ preset: "pill" });
    render(<RadiusSettings editor={editor} />);
    await user.click(screen.getByRole("button", { name: "Default" }));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("radius", { preset: undefined });
  });

  it("the 'apply to buttons' toggle is greyed (pointer-events-none) until a preset is chosen", () => {
    render(<RadiusSettings editor={makeEditor({})} />);
    const row = screen.getByText("Also apply to buttons and form inputs").closest("div")!;
    expect(row.className).toContain("pointer-events-none");
  });

  it("with a preset set, the toggle is live and writes applyToButtons", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ preset: "rounded" });
    render(<RadiusSettings editor={editor} />);
    const row = screen.getByText("Also apply to buttons and form inputs").closest("div")!;
    expect(row.className).not.toContain("pointer-events-none");
    await user.click(row.querySelector('[role="switch"]')!);
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("radius", { applyToButtons: true });
  });
});
