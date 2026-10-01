import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import OutletDeliveryTab from "./OutletDeliveryTab";
import { ToastProvider } from "@/components/ui/Toast";
import type { Outlet, Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
  updateOutlet: vi.fn(),
  updateShop: vi.fn(),
  // OutletDeliveryTab embeds OutletDeliveryAreaTab (the merged
  // Delivery/Delivery Area tabs) directly, which fetches this on mount.
  listDeliveryZones: vi.fn().mockResolvedValue([]),
  deleteDeliveryZone: vi.fn(),
  updateDeliveryZone: vi.fn(),
  getZoneMappingProposal: vi.fn().mockResolvedValue({ mode: "regions", unconfirmedActiveZones: 0, zones: [] }),
  getRegions: vi.fn().mockResolvedValue({ country: null, regions: [] }),
}));
import { getShop, updateShop } from "@/lib/api";

function fakeShop(): Shop {
  return {
    deliveryPaymentCardOnline: true,
    deliveryPaymentCashOnDelivery: true,
    deliveryPaymentCardOnDelivery: false,
    deliveryHours: null,
    deliveryTimeSlotGapMinutes: 30,
    deliveryPreparationTimeMinutes: 15,
    deliveryPreparationPlusDeliveryTimeMinutes: 45,
    estimatedDeliveryTimeFrom: 30,
    estimatedDeliveryTimeTo: 60,
    estimatedDeliveryTimeUnit: "minutes",
    sameDayCutoffTime: "14:00",
  } as unknown as Shop;
}

const outlet = { id: 1, deliveryEnabled: true, deliveryRadiusKm: 5, latitude: 25.2, longitude: 55.3 } as unknown as Outlet;

// The shop-wide delivery settings moved to Settings > Fulfilment > Delivery.
// The outlet tab keeps a read-only summary and a link; it must not be able to
// write them any more.
describe("OutletDeliveryTab shop-wide summary", () => {
  it("shows the current shop-wide values read-only, with a link to change them for all outlets", async () => {
    vi.mocked(getShop).mockResolvedValue(fakeShop());
    render(
      <ToastProvider>
        <OutletDeliveryTab outlet={outlet} onSaved={vi.fn()} />
      </ToastProvider>,
    );

    await screen.findByText("Preparation + delivery time");
    expect(screen.getByText("Card (online), Cash on Delivery")).toBeInTheDocument();
    expect(screen.getByText("Every day, 09:00 to 18:00")).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
    expect(screen.getByText("30 to 60 minutes")).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Change for all outlets/ })).toHaveAttribute(
      "href",
      "/settings/fulfilment/delivery",
    );
  });

  it("has no editable shop-wide controls and never calls updateShop", async () => {
    vi.mocked(getShop).mockResolvedValue(fakeShop());
    render(
      <ToastProvider>
        <OutletDeliveryTab outlet={outlet} onSaved={vi.fn()} />
      </ToastProvider>,
    );
    await screen.findByText("Preparation + delivery time");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Preparation Time (minutes)")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(updateShop).not.toHaveBeenCalled();
  });

  it("still edits the per-outlet availability", async () => {
    vi.mocked(getShop).mockResolvedValue(fakeShop());
    render(
      <ToastProvider>
        <OutletDeliveryTab outlet={outlet} onSaved={vi.fn()} />
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.getByText("Delivery available")).toBeInTheDocument());
  });
});
