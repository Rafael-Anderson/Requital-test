import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AddonPrompt from "./AddonPrompt";

vi.mock("@/lib/shop-context", () => ({ useShop: () => ({ shop: { currency: "KWD" } }) }));
vi.mock("@/lib/cart", () => ({ useCart: () => ({ addItem: vi.fn() }) }));
vi.mock("@/components/CurrencySymbol", () => ({ default: () => null }));
vi.mock("@/lib/api", () => ({
  listProducts: vi.fn().mockResolvedValue([{ id: 5, name: "Ribbon", price: "2.5", thumbnail: "", stockQuantity: null, taxRate: null }]),
}));

afterEach(cleanup);

describe("AddonPrompt", () => {
  it("is a named dialog, formats the price by currency, and Escape skips it", async () => {
    const onDone = vi.fn();
    render(<AddonPrompt shopSlug="s" outletId={1} excludeProductIds={[]} onDone={onDone} />);
    const dialog = await screen.findByRole("dialog", { name: "Would you like to add any extras?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText(/2\.500/)).toBeTruthy();
    await waitFor(() => {
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onDone).toHaveBeenCalled();
    });
  });
});
