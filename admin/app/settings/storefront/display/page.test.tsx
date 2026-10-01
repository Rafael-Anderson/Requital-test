import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StorefrontDisplayPage from "./page";
import type { Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({ getShop: vi.fn(), updateShop: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
import { getShop, updateShop } from "@/lib/api";

const shop = {
  productDisplayOrientation: "grid",
  productImageZoomEnabled: true,
  showCollectionMenu: true,
} as unknown as Shop;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getShop).mockResolvedValue(shop);
  vi.mocked(updateShop).mockResolvedValue(shop);
});

describe("Storefront Display", () => {
  it("sends the same three keys Store Configuration sent for them", async () => {
    const user = userEvent.setup();
    render(<StorefrontDisplayPage />);
    await user.click(await screen.findByRole("checkbox", { name: "Show collection menu" }));
    await user.click(screen.getByRole("button", { name: "List" }));
    await user.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(updateShop).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateShop).mock.calls[0][0]).toEqual({
      productDisplayOrientation: "list",
      productImageZoomEnabled: true,
      showCollectionMenu: false,
    });
  });
});
