import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FloatingElementsSettings from "./FloatingElementsSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

function makeEditor(floatingElements: unknown): ThemeEditorState {
  return {
    config: { globalSettings: { floatingElements } },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

describe("FloatingElementsSettings", () => {
  it("renders with the DEFAULT guard when floatingElements is undefined (older theme)", () => {
    render(<FloatingElementsSettings editor={makeEditor(undefined)} />);
    expect(screen.getByText("Floating WhatsApp button")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add button/i })).toBeInTheDocument();
  });

  it("toggling WhatsApp on calls updateGlobalSettingsCategory('floatingElements', ...)", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ whatsapp: { enabled: false }, customButtons: [] });
    render(<FloatingElementsSettings editor={editor} />);
    await user.click(screen.getByRole("switch"));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith(
      "floatingElements",
      expect.objectContaining({ whatsapp: expect.objectContaining({ enabled: true }) }),
    );
  });

  it("'Add button' appends a custom button", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ whatsapp: { enabled: false }, customButtons: [] });
    render(<FloatingElementsSettings editor={editor} />);
    await user.click(screen.getByRole("button", { name: /add button/i }));
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith(
      "floatingElements",
      expect.objectContaining({ customButtons: [expect.objectContaining({ label: "", url: "" })] }),
    );
  });
});
