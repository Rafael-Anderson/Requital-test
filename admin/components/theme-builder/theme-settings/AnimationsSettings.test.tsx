import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnimationsSettings from "./AnimationsSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

function makeEditor(animations: Record<string, unknown>): ThemeEditorState {
  return {
    config: { globalSettings: { animations } },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

const base = { pageTransition: false, productCardTransition: true, addToCart: false, cardHoverEffect: "zoom" };

describe("AnimationsSettings — post-G0 batch additions", () => {
  it("renders all nine card hover effect options, including the five new ones", () => {
    render(<AnimationsSettings editor={makeEditor(base)} />);
    const select = screen.getByLabelText("Card hover effect") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining(["none", "zoom", "rise", "swap", "desaturate", "quick-add-slide", "overlay", "shadow", "tilt"]),
    );
  });

  it("picking a new hover effect writes it through updateGlobalSettingsCategory", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(base);
    render(<AnimationsSettings editor={editor} />);
    await user.selectOptions(screen.getByLabelText("Card hover effect"), "desaturate");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("animations", { cardHoverEffect: "desaturate" });
  });

  it("defaults the image load select to 'none' when unset (pre-batch theme)", () => {
    render(<AnimationsSettings editor={makeEditor(base)} />);
    const select = screen.getByLabelText("Product image load") as HTMLSelectElement;
    expect(select.value).toBe("none");
  });

  it("picking 'fade' writes imageLoad through updateGlobalSettingsCategory", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(base);
    render(<AnimationsSettings editor={editor} />);
    await user.selectOptions(screen.getByLabelText("Product image load"), "fade");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("animations", { imageLoad: "fade" });
  });
});
