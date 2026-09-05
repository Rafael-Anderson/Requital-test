import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IconsSettings from "./IconsSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

function makeEditor(icons: Record<string, unknown>): ThemeEditorState {
  return {
    config: { globalSettings: { icons } },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

describe("IconsSettings", () => {
  it("renders with corners undefined (pre-existing theme) — Rounded is the selected button", () => {
    render(<IconsSettings editor={makeEditor({ stroke: "default" })} />);
    // SegmentedToggle marks the active option with the accent background.
    expect(screen.getByRole("button", { name: "Rounded" }).className).toContain("bg-accent");
    expect(screen.getByRole("button", { name: "Sharp" }).className).not.toContain("bg-accent");
    expect(screen.getByText("Applies to the header and search icons.")).toBeInTheDocument();
  });

  it("picking Sharp writes { corners: 'sharp' }", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ stroke: "default" });
    render(<IconsSettings editor={editor} />);
    await user.click(screen.getByRole("button", { name: "Sharp" }));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("icons", { corners: "sharp" });
  });

  it("picking Rounded writes { corners: undefined } (the true no-op)", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ stroke: "default", corners: "sharp" });
    render(<IconsSettings editor={editor} />);
    await user.click(screen.getByRole("button", { name: "Rounded" }));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("icons", { corners: undefined });
  });

  it("the stroke-width control still works alongside", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ stroke: "default" });
    render(<IconsSettings editor={editor} />);
    await user.click(screen.getByRole("button", { name: "Heavy" }));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("icons", { stroke: "heavy" });
  });
});
