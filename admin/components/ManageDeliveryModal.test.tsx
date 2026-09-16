import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ManageDeliveryModal, { formatDuration, paymentModeLabel } from "./ManageDeliveryModal";
import { ToastProvider } from "@/components/ui/Toast";
import type { Order, SliderQuote } from "@/lib/types";

afterEach(cleanup);
afterEach(() => vi.clearAllMocks());

vi.mock("@/lib/api", () => ({
  getSliderQuote: vi.fn(),
  dispatchSliderDelivery: vi.fn(),
}));
import { dispatchSliderDelivery, getSliderQuote } from "@/lib/api";

function fakeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 42,
    outletId: 1,
    customerName: "Jane Shopper",
    customerPhone: "0501234567",
    customerEmail: null,
    customerAddress: "123 Street",
    emirate: "Dubai",
    area: "Al Barsha",
    deliveryDate: null,
    deliveryTimeSlot: null,
    deliveryNotes: null,
    receiverMessage: null,
    channel: "storefront",
    orderType: "delivery",
    status: "confirmed",
    paymentStatus: "paid",
    paymentMethod: "card_online",
    cashCollectedAt: null,
    cashCollectedBy: null,
    cashCollectedByName: null,
    deliveryFee: "10",
    total: "60",
    createdAt: new Date().toISOString(),
    trackingToken: null,
    paymentLinkToken: null,
    paymentLinkExpiresAt: null,
    orderitem: [],
    paymenttransaction: [{ id: 1, gateway: "stripe", status: "succeeded", amount: "60", createdAt: new Date().toISOString() }],
    ...overrides,
  } as Order;
}

const quoteFixture: SliderQuote = {
  distanceKm: 5.2,
  durationMinutes: 35,
  vehicles: [
    { vehicleType: "bike", deliveryFee: 12.5, isAvailable: true, unavailableReason: null },
    { vehicleType: "car", deliveryFee: 20, isAvailable: true, unavailableReason: null },
  ],
};

function renderModal(order = fakeOrder()) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <ToastProvider>
      <ManageDeliveryModal order={order} onClose={onClose} onChanged={onChanged} />
    </ToastProvider>,
  );
  return { onClose, onChanged };
}

async function selectCompanyAndCalculate(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Delivery Company"), "slider");
  await user.click(screen.getByRole("button", { name: "Calculate" }));
  await waitFor(() => expect(screen.getByText("Customer & Order Details")).toBeInTheDocument());
}

describe("ManageDeliveryModal", () => {
  it("reveals Vehicle Type + Calculate only after a company is chosen", async () => {
    const user = userEvent.setup();
    vi.mocked(getSliderQuote).mockResolvedValue(quoteFixture);
    renderModal();

    expect(screen.queryByLabelText("Vehicle Type")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Delivery Company"), "slider");
    expect(screen.getByLabelText("Vehicle Type")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calculate" })).toBeInTheDocument();
  });

  it("Calculate calls getSliderQuote once and reveals the results panels", async () => {
    const user = userEvent.setup();
    vi.mocked(getSliderQuote).mockResolvedValue(quoteFixture);
    renderModal();

    await selectCompanyAndCalculate(user);

    expect(getSliderQuote).toHaveBeenCalledTimes(1);
    expect(getSliderQuote).toHaveBeenCalledWith(42);
    expect(screen.getAllByText("12.50 AED").length).toBeGreaterThan(0); // bike, the default vehicle
    expect(screen.getByText("Customer & Order Details")).toBeInTheDocument();
    expect(screen.getByText("Delivery Information")).toBeInTheDocument();
    expect(screen.getByText("Card (Paid Online)")).toBeInTheDocument();
    expect(screen.getByText("Paid via stripe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Immediate Delivery" })).toBeInTheDocument();
  });

  it("switching vehicle type after a quote updates the charge without re-fetching", async () => {
    const user = userEvent.setup();
    vi.mocked(getSliderQuote).mockResolvedValue(quoteFixture);
    renderModal();
    await selectCompanyAndCalculate(user);

    await user.selectOptions(screen.getByLabelText("Vehicle Type"), "car");

    expect(screen.getAllByText("20.00 AED").length).toBeGreaterThan(0);
    expect(getSliderQuote).toHaveBeenCalledTimes(1);
  });

  it("selecting Schedule Delivery reveals the date-time picker", async () => {
    const user = userEvent.setup();
    vi.mocked(getSliderQuote).mockResolvedValue(quoteFixture);
    renderModal();
    await selectCompanyAndCalculate(user);

    expect(screen.queryByText("Select date & time")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Schedule Delivery" }));
    expect(screen.getByText("Select date & time")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Delivery" })).toBeDisabled();
  });

  it("Create Delivery dispatches with no scheduleAt for immediate delivery, then closes", async () => {
    const user = userEvent.setup();
    vi.mocked(getSliderQuote).mockResolvedValue(quoteFixture);
    vi.mocked(dispatchSliderDelivery).mockResolvedValue(fakeOrder());
    const { onClose, onChanged } = renderModal();
    await selectCompanyAndCalculate(user);

    await user.click(screen.getByRole("button", { name: "Create Delivery" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(dispatchSliderDelivery).toHaveBeenCalledWith(42, { vehicleType: "bike", scheduleAt: undefined });
    expect(onClose).toHaveBeenCalled();
  });

  it("a failed dispatch shows an inline error and keeps the modal + selections", async () => {
    const user = userEvent.setup();
    vi.mocked(getSliderQuote).mockResolvedValue(quoteFixture);
    vi.mocked(dispatchSliderDelivery).mockRejectedValue(new Error("Distance exceeds bike cap"));
    const { onClose, onChanged } = renderModal();
    await selectCompanyAndCalculate(user);

    await user.click(screen.getByRole("button", { name: "Create Delivery" }));

    await waitFor(() => expect(screen.getByText("Distance exceeds bike cap")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getAllByText("12.50 AED").length).toBeGreaterThan(0); // quote/selection still intact
  });
});

describe("formatDuration", () => {
  it("formats minutes under an hour plainly", () => {
    expect(formatDuration(35)).toBe("35 min");
  });
  it("formats an hour-plus duration with hours and remaining minutes", () => {
    expect(formatDuration(75)).toBe("1 hr 15 min");
    expect(formatDuration(120)).toBe("2 hr");
  });
});

describe("paymentModeLabel", () => {
  it("labels an online card payment with its gateway sub-line", () => {
    const result = paymentModeLabel(fakeOrder({ paymentMethod: "card_online" }));
    expect(result).toEqual({ label: "Card (Paid Online)", gatewaySubline: "Paid via stripe" });
  });
  it("has no gateway sub-line for cash on delivery", () => {
    const result = paymentModeLabel(fakeOrder({ paymentMethod: "cash_on_delivery", paymenttransaction: [] }));
    expect(result).toEqual({ label: "Cash (Pay on Delivery)", gatewaySubline: null });
  });
});
