import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputFieldsSettings from "./InputFieldsSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

function makeEditor(inputFields: Record<string, unknown> = {}): ThemeEditorState {
  return {
    config: { globalSettings: { inputFields: { borderThickness: 1, cornerRadius: 8, textPreset: "paragraph", ...inputFields } } },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

describe("InputFieldsSettings — focusAnimation (§8.13.C item 7)", () => {
  it("defaults the select to 'none' and offers only None / Floating label", () => {
    render(<InputFieldsSettings editor={makeEditor()} />);
    const select = screen.getByLabelText("Focus animation") as HTMLSelectElement;
    expect(select.value).toBe("none");
    expect(screen.queryByRole("option", { name: /glow|border/i })).toBeNull();
  });

  it("'float-label' writes the value, 'none' writes undefined", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ focusAnimation: "float-label" });
    render(<InputFieldsSettings editor={editor} />);
    const select = screen.getByLabelText("Focus animation");
    await user.selectOptions(select, "none");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("inputFields", { focusAnimation: undefined });
    await user.selectOptions(select, "float-label");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("inputFields", { focusAnimation: "float-label" });
  });
});
