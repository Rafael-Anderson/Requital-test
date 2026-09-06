import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ButtonsSettings from "./ButtonsSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// Each ButtonStyleFields is a <details> whose <summary> is the label.
function fieldset(label: string) {
  return screen.getByText(label).closest("details") as HTMLElement;
}

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

describe("ButtonsSettings — hoverEffect/pressEffect (§8.7 item 1 / §8.13.C item 2)", () => {
  it("renders Hover effect + Press effect under BOTH Primary and Secondary now", () => {
    render(<ButtonsSettings editor={makeEditor()} />);
    expect(screen.getAllByLabelText("Hover effect")).toHaveLength(2);
    expect(screen.getAllByText("Press effect")).toHaveLength(2);
  });

  it("defaults Hover effect to 'none' when unset (primary)", () => {
    render(<ButtonsSettings editor={makeEditor()} />);
    expect(within(fieldset("Primary button")).getByLabelText("Hover effect")).toHaveValue("none");
  });

  it("picking a hover effect under Primary merges the primary patch", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    render(<ButtonsSettings editor={editor} />);
    await user.selectOptions(within(fieldset("Primary button")).getByLabelText("Hover effect"), "sweep");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith(
      "buttons",
      expect.objectContaining({ primary: expect.objectContaining({ hoverEffect: "sweep" }) }),
    );
  });

  it("picking a hover effect under Secondary merges the secondary patch", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    render(<ButtonsSettings editor={editor} />);
    await user.selectOptions(within(fieldset("Secondary button")).getByLabelText("Hover effect"), "border-fill");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith(
      "buttons",
      expect.objectContaining({ secondary: expect.objectContaining({ hoverEffect: "border-fill" }) }),
    );
  });

  it("toggling Primary Press effect merges the primary patch", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    render(<ButtonsSettings editor={editor} />);
    await user.click(within(fieldset("Primary button")).getByRole("switch"));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith(
      "buttons",
      expect.objectContaining({ primary: expect.objectContaining({ pressEffect: true }) }),
    );
  });
});
