import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import OutletPickupTab from "./OutletPickupTab";
import { ToastProvider } from "@/components/ui/Toast";
import type { Outlet, Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
  updateOutlet: vi.fn(),
  updateShop: vi.fn(),
}));
import { getShop, updateShop } from "@/lib/api";

const shop = {
  pickupPaymentCardOnline: true,
  pickupPaymentCashOnPickup: true,
  pickupPaymentCardOnPickup: false,
  pickupHours: null,
  pickupTimeSlotGapMinutes: 15,
  pickupPreparationTimeMinutes: 10,
  pickupPreparationPlusTimeMinutes: 20,
} as unknown as Shop;

const outlet = { id: 1, pickupEnabled: true } as unknown as Outlet;

// The shop-wide pickup settings moved to Settings > Fulfilment > Pickup.
describe("OutletPickupTab shop-wide summary", () => {
  it("shows the current shop-wide values read-only, with a link to change them for all outlets", async () => {
    vi.mocked(getShop).mockResolvedValue(shop);
    render(
      <ToastProvider>
        <OutletPickupTab outlet={outlet} onSaved={vi.fn()} />
      </ToastProvider>,
    );

    await screen.findByText("Preparation + pickup time");
    expect(screen.getByText("Card (online), Cash on Pickup")).toBeInTheDocument();
    expect(screen.getByText("15 min")).toBeInTheDocument();
    expect(screen.getByText("20 min")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Change for all outlets/ })).toHaveAttribute(
      "href",
      "/settings/fulfilment/pickup",
    );
  });

  it("has no editable shop-wide controls and never calls updateShop", async () => {
    vi.mocked(getShop).mockResolvedValue(shop);
    render(
      <ToastProvider>
        <OutletPickupTab outlet={outlet} onSaved={vi.fn()} />
      </ToastProvider>,
    );
    await screen.findByText("Preparation + pickup time");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(updateShop).not.toHaveBeenCalled();
  });
});
