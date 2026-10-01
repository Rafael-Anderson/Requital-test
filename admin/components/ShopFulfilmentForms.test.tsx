import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";
import ShopDeliverySettingsForm from "./ShopDeliverySettingsForm";
import ShopPickupSettingsForm from "./ShopPickupSettingsForm";
import OrderDatesCard from "./OrderDatesCard";
import type { Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({ getShop: vi.fn(), updateShop: vi.fn() }));
import { getShop, updateShop } from "@/lib/api";

const shop = {
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
  sameDayCutoffTime: null,
  pickupPaymentCardOnline: true,
  pickupPaymentCashOnPickup: true,
  pickupPaymentCardOnPickup: false,
  pickupHours: null,
  pickupTimeSlotGapMinutes: 15,
  pickupPreparationTimeMinutes: 10,
  pickupPreparationPlusTimeMinutes: 20,
  allowSameDayOrders: true,
  allowNextDayOrders: true,
} as unknown as Shop;

const WEEK = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "09:00", close: "18:00", closed: false }]),
);

function combo(label: string) {
  return within(screen.getByText(label).closest("div") as HTMLElement).getByRole("combobox");
}

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getShop).mockResolvedValue(shop);
  vi.mocked(updateShop).mockResolvedValue({} as Shop);
});

// The expected payloads below are NOT derived from the new components: they
// are the literal objects the OLD OutletDeliveryTab / OutletPickupTab /
// OutletBasicInfoTab sent for the same shop and the same edits (captured by
// running those components, then removed, when the fields moved). The
// guarantee is that moving the UI did not change what is sent.
describe("ShopDeliverySettingsForm", () => {
  it("sends exactly the payload the old Delivery tab sent, with no confirm dialog", async () => {
    const user = userEvent.setup();
    renderWithToast(<ShopDeliverySettingsForm />);
    await waitFor(() => expect(combo("Time Slot Gap")).toHaveTextContent("30 minutes"));

    await user.click(combo("Time Slot Gap"));
    await user.click(await screen.findByRole("option", { name: "1 hour" }));
    await user.click(screen.getByRole("checkbox", { name: /Card on Delivery/ }));
    const prep = screen.getByLabelText("Preparation Time (minutes)");
    await user.clear(prep);
    await user.type(prep, "20");
    await user.type(screen.getByLabelText("Cutoff time"), "14:30");
    await user.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => expect(updateShop).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateShop).mock.calls[0][0]).toEqual({
      deliveryPaymentCardOnline: true,
      deliveryPaymentCashOnDelivery: true,
      deliveryPaymentCardOnDelivery: true,
      deliveryHours: WEEK,
      deliveryTimeSlotGapMinutes: 60,
      deliveryPreparationTimeMinutes: 20,
      deliveryPreparationPlusDeliveryTimeMinutes: 45,
      estimatedDeliveryTimeFrom: 30,
      estimatedDeliveryTimeTo: 60,
      estimatedDeliveryTimeUnit: "minutes",
      sameDayCutoffTime: "14:30",
    });
    expect(screen.queryByText("This changes every outlet")).not.toBeInTheDocument();
  });

  it("sends a blank cutoff as null, as before", async () => {
    const user = userEvent.setup();
    renderWithToast(<ShopDeliverySettingsForm />);
    await waitFor(() => expect(combo("Time Slot Gap")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(updateShop).toHaveBeenCalled());
    expect(vi.mocked(updateShop).mock.calls[0][0]).toMatchObject({ sameDayCutoffTime: null });
  });

  it("says the settings apply to every outlet and links to the payment gateways", async () => {
    renderWithToast(<ShopDeliverySettingsForm />);
    await screen.findByText(/These apply to every outlet/);
    expect(screen.getByRole("link", { name: /Integrations > Payments/ })).toHaveAttribute("href", "/integrations/payments");
  });
});

describe("ShopPickupSettingsForm", () => {
  it("sends exactly the payload the old Pickup tab sent, with no confirm dialog", async () => {
    const user = userEvent.setup();
    renderWithToast(<ShopPickupSettingsForm />);
    await waitFor(() => expect(combo("Time Slot Gap")).toHaveTextContent("15 minutes"));

    await user.click(combo("Time Slot Gap"));
    await user.click(await screen.findByRole("option", { name: "45 minutes" }));
    await user.click(screen.getByRole("checkbox", { name: /Cash on Pickup/ }));
    await user.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => expect(updateShop).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateShop).mock.calls[0][0]).toEqual({
      pickupPaymentCardOnline: true,
      pickupPaymentCashOnPickup: false,
      pickupPaymentCardOnPickup: false,
      pickupHours: WEEK,
      pickupTimeSlotGapMinutes: 45,
      pickupPreparationTimeMinutes: 10,
      pickupPreparationPlusTimeMinutes: 20,
    });
    expect(screen.queryByText("This changes every outlet")).not.toBeInTheDocument();
  });
});

describe("OrderDatesCard", () => {
  // Old Basic Info payload for this edit was
  // {allowSameDayOrders:true, allowNextDayOrders:false, taxRate:7.5, taxInclusive:true, taxOnDelivery:false};
  // the two order-date keys are unchanged, the tax keys now go from Money & Tax.
  it("sends the same two order-date keys with the same values", async () => {
    const user = userEvent.setup();
    renderWithToast(<OrderDatesCard />);
    await user.click(await screen.findByRole("checkbox", { name: "Next-day orders" }));
    await user.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(updateShop).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateShop).mock.calls[0][0]).toEqual({ allowSameDayOrders: true, allowNextDayOrders: false });
  });
});
