import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductCardsSettings from "./ProductCardsSettings";
import type { ThemeEditorState } from "@/lib/useThemeEditor";

function makeEditor(productCards: Record<string, unknown>): ThemeEditorState {
  return {
    config: { globalSettings: { productCards } },
    updateGlobalSettingsCategory: vi.fn(),
  } as unknown as ThemeEditorState;
}

const base = {
  quickAdd: true,
  mobileQuickAdd: false,
  quickAddBackground: "#ffffff",
  quickAddText: "#18181b",
  showCarousel: true,
  productNameFontSize: 14,
  productNameFontWeight: "regular",
  productNameColor: "#1B1F1E",
  showProductDescriptions: false,
};

describe("ProductCardsSettings — wishlist toggle", () => {
  it("renders the wishlist toggle unchecked when showWishlist is absent (older theme)", () => {
    render(<ProductCardsSettings editor={makeEditor(base)} />);
    const label = screen.getByText("Show wishlist heart on product cards");
    expect(label).toBeInTheDocument();
  });

  it("toggling it on calls updateGlobalSettingsCategory('productCards', { showWishlist: true })", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(base);
    render(<ProductCardsSettings editor={editor} />);
    // The row's own toggle — find it by the label text, then its sibling switch.
    const row = screen.getByText("Show wishlist heart on product cards").closest("div")!;
    await user.click(row.querySelector('[role="switch"]')!);
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("productCards", {
      showWishlist: true,
    });
  });

  it("hides the animation Select until showWishlist is on", () => {
    render(<ProductCardsSettings editor={makeEditor({ ...base, showWishlist: false })} />);
    expect(screen.queryByLabelText("Wishlist heart animation")).not.toBeInTheDocument();
  });

  it("with showWishlist on, selecting an option writes wishlistAnimation (no 'sweep' offered)", async () => {
    const user = userEvent.setup();
    const editor = makeEditor({ ...base, showWishlist: true });
    render(<ProductCardsSettings editor={editor} />);
    const select = screen.getByLabelText("Wishlist heart animation");
    expect(screen.queryByRole("option", { name: /sweep/i })).not.toBeInTheDocument();
    await user.selectOptions(select, "burst");
    expect(editor.updateGlobalSettingsCategory).toHaveBeenCalledWith("productCards", {
      wishlistAnimation: "burst",
    });
  });
});
