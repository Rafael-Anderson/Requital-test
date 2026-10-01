import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StoreConfigurationPage from "./page";
import type { Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
  updateShop: vi.fn(),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

import { getShop, updateShop } from "@/lib/api";

// Only the fields this page reads on mount; the rest of Shop is irrelevant here.
const shop = {
  businessType: "Florist",
  defaultLanguage: "en",
  defaultDeliveryFee: "0",
  businessHours: null,
} as unknown as Shop;

// Currency and Tax Display Text moved to Selling > Money & Tax, and the three
// storefront presentation settings to Storefront > Display (Settings IA
// restructure). This page keeps its old route, so a bookmark still lands here
// and is told where they went. The currency dropdown tests moved with the field
// (app/settings/selling/money-tax/page.test.tsx).
describe("StoreConfigurationPage after the Settings restructure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getShop).mockResolvedValue(shop);
    vi.mocked(updateShop).mockResolvedValue(shop);
  });

  it("no longer offers the moved fields", async () => {
    render(<StoreConfigurationPage />);
    await screen.findByText("Business Type");
    expect(screen.queryByText("Currency")).not.toBeInTheDocument();
    expect(screen.queryByText("Tax Display Text")).not.toBeInTheDocument();
    expect(screen.queryByText("Product Display Orientation")).not.toBeInTheDocument();
    expect(screen.queryByText(/Product image zoom/)).not.toBeInTheDocument();
    expect(screen.queryByText("Show collection menu")).not.toBeInTheDocument();
  });

  it("points at where each moved setting went", async () => {
    render(<StoreConfigurationPage />);
    const money = await screen.findByRole("link", { name: /Money & Tax/ });
    expect(money).toHaveAttribute("href", "/settings/selling/money-tax");
    expect(screen.getByRole("link", { name: /Storefront > Display/ })).toHaveAttribute(
      "href",
      "/settings/storefront/display",
    );
  });

  it("does not send the moved keys when saving what is left", async () => {
    const user = userEvent.setup();
    render(<StoreConfigurationPage />);
    await user.click(await screen.findByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(updateShop).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(updateShop).mock.calls[0][0] as Record<string, unknown>;
    for (const moved of [
      "currency",
      "taxDisplayText",
      "productDisplayOrientation",
      "productImageZoomEnabled",
      "showCollectionMenu",
    ]) {
      expect(sent, moved).not.toHaveProperty(moved);
    }
    expect(sent).toMatchObject({ businessType: "Florist", defaultLanguage: "en" });
  });
});
