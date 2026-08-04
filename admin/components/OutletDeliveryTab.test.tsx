import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OutletDeliveryTab from "./OutletDeliveryTab";
import { ToastProvider } from "@/components/ui/Toast";
import type { Outlet, Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
  updateOutlet: vi.fn(),
  updateShop: vi.fn(),
}));
import { getShop } from "@/lib/api";

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
  } as unknown as Shop;
}

function fakeOutlet(): Outlet {
  return {
    id: 1,
    deliveryEnabled: true,
    deliveryRadiusKm: 5,
    latitude: 25.2,
    longitude: 55.3,
  } as unknown as Outlet;
}

function getCombobox(labelText: string) {
  const container = screen.getByText(labelText).closest("div");
  return within(container as HTMLElement).getByRole("combobox");
}

describe("OutletDeliveryTab — Time Slot Gap / delivery estimate Type pickers", () => {
  it("renders both pickers as Comboboxes, not native selects", async () => {
    vi.mocked(getShop).mockResolvedValue(fakeShop());
    render(
      <ToastProvider>
        <OutletDeliveryTab outlet={fakeOutlet()} onSaved={vi.fn()} />
      </ToastProvider>,
    );

    await waitFor(() => expect(getCombobox("Time Slot Gap")).toHaveTextContent("30 minutes"));
    expect(getCombobox("Type")).toBeInTheDocument();
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("selecting a new Time Slot Gap option updates the value", async () => {
    const user = userEvent.setup();
    vi.mocked(getShop).mockResolvedValue(fakeShop());
    render(
      <ToastProvider>
        <OutletDeliveryTab outlet={fakeOutlet()} onSaved={vi.fn()} />
      </ToastProvider>,
    );

    await waitFor(() => expect(getCombobox("Time Slot Gap")).toHaveTextContent("30 minutes"));
    await user.click(getCombobox("Time Slot Gap"));
    await user.click(await screen.findByRole("option", { name: "1 hour" }));
    expect(getCombobox("Time Slot Gap")).toHaveTextContent("1 hour");
  });
});
