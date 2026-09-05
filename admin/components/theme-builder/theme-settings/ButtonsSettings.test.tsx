import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ButtonsSettings from "./ButtonsSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

function makeEditor(primary: Record<string, unknown> = {}, secondary: Record<string, unknown> = {}): ThemeEditorState {
  return {
    config: {
      globalSettings: {
        buttons: {
          primary: { borderThickness: 0, cornerRadius: 8, font: "body", case: "default", ...primary },
          secondary: { borderThickness: 1, cornerRadius: 8, font: "body", case: "default", ...secondary },
          pillCornerRadius: 9999,
        },
      },
    },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

describe("ButtonsSettings — hoverEffect/pressEffect (§8.7 item 1)", () => {
  it("renders Hover effect + Press effect only under Primary button, not Secondary", () => {
    render(<ButtonsSettings editor={makeEditor()} />);
    expect(screen.getAllByLabelText("Hover effect")).toHaveLength(1);
    expect(screen.getAllByText("Press effect")).toHaveLength(1);
  });

  it("defaults Hover effect to 'none' when unset", () => {
    render(<ButtonsSettings editor={makeEditor()} />);
    expect(screen.getByLabelText("Hover effect")).toHaveValue("none");
  });

  it("picking a hover effect calls updateGlobalSettingsCategory with the primary patch merged in", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    render(<ButtonsSettings editor={editor} />);
    await user.selectOptions(screen.getByLabelText("Hover effect"), "sweep");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith(
      "buttons",
      expect.objectContaining({ primary: expect.objectContaining({ hoverEffect: "sweep" }) }),
    );
  });

  it("toggling Press effect calls updateGlobalSettingsCategory with pressEffect true", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    render(<ButtonsSettings editor={editor} />);
    await user.click(screen.getByRole("switch"));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith(
      "buttons",
      expect.objectContaining({ primary: expect.objectContaining({ pressEffect: true }) }),
    );
  });
});
