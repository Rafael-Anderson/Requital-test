import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OutletPickupTab from "./OutletPickupTab";
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
    pickupPaymentCardOnline: true,
    pickupPaymentCashOnPickup: true,
    pickupPaymentCardOnPickup: false,
    pickupHours: null,
    pickupTimeSlotGapMinutes: 15,
    pickupPreparationTimeMinutes: 10,
    pickupPreparationPlusTimeMinutes: 20,
  } as unknown as Shop;
}

function fakeOutlet(): Outlet {
  return { id: 1, pickupEnabled: true } as unknown as Outlet;
}

function getCombobox(labelText: string) {
  const container = screen.getByText(labelText).closest("div");
  return within(container as HTMLElement).getByRole("combobox");
}

describe("OutletPickupTab — Time Slot Gap picker", () => {
  it("renders the picker as a Combobox, not a native select", async () => {
    vi.mocked(getShop).mockResolvedValue(fakeShop());
    render(
      <ToastProvider>
        <OutletPickupTab outlet={fakeOutlet()} onSaved={vi.fn()} />
      </ToastProvider>,
    );

    await waitFor(() => expect(getCombobox("Time Slot Gap")).toHaveTextContent("15 minutes"));
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("selecting a new option updates the value", async () => {
    const user = userEvent.setup();
    vi.mocked(getShop).mockResolvedValue(fakeShop());
    render(
      <ToastProvider>
        <OutletPickupTab outlet={fakeOutlet()} onSaved={vi.fn()} />
      </ToastProvider>,
    );

    await waitFor(() => expect(getCombobox("Time Slot Gap")).toHaveTextContent("15 minutes"));
    await user.click(getCombobox("Time Slot Gap"));
    await user.click(await screen.findByRole("option", { name: "45 minutes" }));
    expect(getCombobox("Time Slot Gap")).toHaveTextContent("45 minutes");
  });
});
