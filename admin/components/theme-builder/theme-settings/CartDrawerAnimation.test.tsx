import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CartSettings from "./CartSettings";
import DrawersSettings from "./DrawersSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

// §8.13.C item 13 — the new cart/drawer animation controls. Every "off"
// value writes undefined so an untouched theme stays byte-identical.

const CART_BASE = {
  allowNote: false, allowDiscounts: false, installments: false, acceleratedCheckout: false,
  mediaBorderStyle: "none", mediaCornerRadius: 0,
};
const DRAWER_BASE = { schemeId: "scheme-1", bordersStyle: "none", dropShadow: false };

function cartEditor(extra: Record<string, unknown> = {}): ThemeEditorState {
  return {
    config: { globalSettings: { cart: { ...CART_BASE, ...extra } } },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}
function drawerEditor(extra: Record<string, unknown> = {}): ThemeEditorState {
  return {
    config: { globalSettings: { drawers: { ...DRAWER_BASE, ...extra }, colorSchemes: [{ id: "scheme-1", name: "One" }] } },
    updateGlobalSettingsCategory: vi.fn(),
    addColorScheme: vi.fn(),
    setEditorMode: vi.fn(),
    setThemeSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

describe("CartSettings — item/subtotal animation (§8.13.C item 13)", () => {
  it("subtotal select: 'count' writes the value, 'none' writes undefined", async () => {
    const user = userEvent.setup();
    const e = cartEditor({ subtotalAnimation: "flash" });
    render(<CartSettings editor={e} />);
    const select = screen.getByLabelText("Subtotal change animation");
    await user.selectOptions(select, "count");
    expect(e.updateGlobalSettingsCategory).toHaveBeenCalledWith("cart", { subtotalAnimation: "count" });
    await user.selectOptions(select, "none");
    expect(e.updateGlobalSettingsCategory).toHaveBeenCalledWith("cart", { subtotalAnimation: undefined });
  });

  it("item-animation toggle writes true / undefined", async () => {
    const user = userEvent.setup();
    const e = cartEditor();
    render(<CartSettings editor={e} />);
    await user.click(screen.getByText("Animate newly added items").closest("div")!.querySelector('[role="switch"]')!);
    expect(e.updateGlobalSettingsCategory).toHaveBeenCalledWith("cart", { itemAnimation: true });
  });
});

describe("DrawersSettings — open animation (§8.13.C item 13)", () => {
  it("'scale' writes the value, 'slide' (default) writes undefined", async () => {
    const user = userEvent.setup();
    const e = drawerEditor({ animation: "slide-fade" });
    render(<DrawersSettings editor={e} />);
    const select = screen.getByLabelText("Cart drawer open animation");
    await user.selectOptions(select, "scale");
    expect(e.updateGlobalSettingsCategory).toHaveBeenCalledWith("drawers", { animation: "scale" });
    await user.selectOptions(select, "slide");
    expect(e.updateGlobalSettingsCategory).toHaveBeenCalledWith("drawers", { animation: undefined });
  });
});
