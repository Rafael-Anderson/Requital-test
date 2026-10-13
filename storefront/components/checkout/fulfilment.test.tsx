import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCheckoutForm } from "@/lib/useCheckoutForm";
import CheckoutSinglePage from "./CheckoutSinglePage";
import CheckoutSteps from "./CheckoutSteps";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/cart", () => ({
  useCart: () => ({
    items: [{ productId: 1, name: "Item", price: 10, quantity: 1, thumbnail: "" }],
    subtotal: 10,
    discountCode: undefined,
    giftCardCode: undefined,
    outletId: 1,
    clear: vi.fn(),
  }),
}));
const auth = vi.hoisted(() => ({ customer: null as null | { name: string; phone: string; email: string } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ customer: auth.customer }) }));
const api = vi.hoisted(() => ({ createOrder: vi.fn() }));
vi.mock("@/lib/api", () => ({
  captureAbandonedCart: vi.fn().mockResolvedValue(undefined),
  createOrder: api.createOrder,
  listMyAddresses: vi.fn().mockResolvedValue([{ id: "a1", label: "Home", address: "1 Palm St" }]),
}));
// Heavy or network children are irrelevant to which fields the selector shows.
vi.mock("@/components/MapPicker", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("./RegionSelect", () => ({ default: () => <div data-testid="region" /> }));
vi.mock("./DeliveryDateCalendar", () => ({ default: () => <div data-testid="calendar" /> }));
vi.mock("@/components/PromoCodeField", () => ({ default: () => null }));
vi.mock("@/components/GiftCardCodeField", () => ({ default: () => null }));
vi.mock("@/components/StoreCreditField", () => ({ default: () => null }));

type TestOutlet = {
  id: number;
  name: string;
  area: string | null;
  phone: string | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  isOpen: boolean;
};
const ctx = vi.hoisted(() => ({ outlets: [] as unknown[] }));
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "s",
    shopBasePath: "",
    regions: [],
    regionLabel: "Region",
    shop: {
      currency: "AED",
      taxRate: "0",
      taxInclusive: false,
      deliveryPaymentCashOnDelivery: true,
      pickupPaymentCashOnPickup: true,
      deliveryPaymentCardOnline: false,
      deliveryPaymentCardOnDelivery: false,
      pickupPaymentCardOnline: false,
      pickupPaymentCardOnPickup: false,
      cardProcessorEnabled: true,
      enabledPaymentProviders: [],
      deliveryHours: null,
      pickupHours: null,
      deliveryTimeSlotGapMinutes: 60,
      pickupTimeSlotGapMinutes: 30,
      allowSameDayOrders: true,
      allowNextDayOrders: true,
    },
    outlets: ctx.outlets,
  }),
}));

// The checkout labels are not associated with their controls (no htmlFor), so
// reach the control through the label's wrapper.
function byLabel(text: string): HTMLElement {
  const control = screen.getByText(text).parentElement?.querySelector("input, select, textarea");
  if (!control) throw new Error(`no control under label ${text}`);
  return control as HTMLElement;
}

const outlet = (o: Partial<TestOutlet> & { id: number }): TestOutlet => ({
  name: `Outlet ${o.id}`,
  area: null,
  phone: null,
  deliveryEnabled: false,
  pickupEnabled: false,
  isOpen: true,
  ...o,
});

function Delivered({ layout }: { layout: "single" | "steps" }) {
  const state = useCheckoutForm();
  return layout === "single" ? <CheckoutSinglePage {...state} /> : <CheckoutSteps {...state} />;
}

// Step layout shows the delivery fields on step 2; click through the contact step.
async function toDeliveryStep(layout: "single" | "steps") {
  if (layout === "single") return;
  await userEvent.type(byLabel("Name"), "Sam");
  await userEvent.type(byLabel("Phone"), "0501234567");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe.each(["single", "steps"] as const)("fulfilment selector (%s layout)", (layout) => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.customer = null;
  });

  it("both: shows the Delivery/Pickup toggle, delivery by default, and switching swaps the fields", async () => {
    ctx.outlets = [outlet({ id: 1, deliveryEnabled: true, pickupEnabled: true })];
    render(<Delivered layout={layout} />);
    expect(screen.getByRole("button", { name: "Delivery" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Pickup" })).toHaveAttribute("aria-pressed", "false");
    await toDeliveryStep(layout);
    expect(screen.getByText("Delivery address")).toBeInTheDocument();
    await userEvent.click(screen.queryByRole("button", { name: "Back" }) ?? screen.getByRole("button", { name: "Pickup" }));
    if (layout === "steps") await userEvent.click(screen.getByRole("button", { name: "Pickup" }));
    expect(screen.queryByText("Delivery address")).not.toBeInTheDocument();
    expect(screen.getByTestId("pickup-details")).toBeInTheDocument();
  });

  it("delivery only: no toggle, no pickup details, address fields shown", async () => {
    ctx.outlets = [outlet({ id: 1, deliveryEnabled: true })];
    render(<Delivered layout={layout} />);
    expect(screen.queryByRole("button", { name: "Delivery" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pickup" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("pickup-details")).not.toBeInTheDocument();
    expect(screen.queryByText(/Pickup location/)).not.toBeInTheDocument();
    await toDeliveryStep(layout);
    expect(screen.getByText("Delivery address")).toBeInTheDocument();
    expect(screen.getByText("Delivery date (optional)")).toBeInTheDocument();
  });

  it("pickup only: no toggle, no address fields, pickup details and pickup date wording", async () => {
    ctx.outlets = [outlet({ id: 1, name: "Marina", area: "Dubai Marina", phone: "+97145550000", pickupEnabled: true })];
    render(<Delivered layout={layout} />);
    expect(screen.queryByRole("button", { name: "Delivery" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pickup" })).not.toBeInTheDocument();
    const details = screen.getByTestId("pickup-details");
    expect(within(details).getByText("Marina")).toBeInTheDocument();
    expect(within(details).getByText("Dubai Marina")).toBeInTheDocument();
    await toDeliveryStep(layout);
    expect(screen.queryByText("Delivery address")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map")).not.toBeInTheDocument();
    expect(screen.getByText("Pickup date (optional)")).toBeInTheDocument();
  });

  it("neither: explains why and Place order is disabled, with no form to fill", () => {
    ctx.outlets = [outlet({ id: 1 })];
    render(<Delivered layout={layout} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Neither delivery nor pickup/);
    expect(screen.getByRole("button", { name: "Place order" })).toBeDisabled();
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
  });

  it("outlet A delivery only, B pickup only: switching outlet changes the order type with no invalid combination", async () => {
    ctx.outlets = [
      outlet({ id: 1, name: "A", deliveryEnabled: true }),
      outlet({ id: 2, name: "B", pickupEnabled: true, area: "Bay" }),
    ];
    render(<Delivered layout={layout} />);
    expect(screen.queryByRole("button", { name: "Pickup" })).not.toBeInTheDocument();
    expect(byLabel("Branch")).toBeInTheDocument();
    await userEvent.selectOptions(byLabel("Branch"), "2");
    await waitFor(() => expect(screen.getByTestId("pickup-details")).toBeInTheDocument());
    expect(byLabel("Pickup location")).toBeInTheDocument();
    await toDeliveryStep(layout);
    expect(screen.queryByText("Delivery address")).not.toBeInTheDocument();
  });

  it("a pickup order never carries an address typed for delivery", async () => {
    ctx.outlets = [
      outlet({ id: 1, name: "A", deliveryEnabled: true, pickupEnabled: true }),
      outlet({ id: 2, name: "B", pickupEnabled: true }),
    ];
    api.createOrder.mockResolvedValue({ order: { id: 9, total: "10", currency: "AED" }, checkoutUrl: null });
    render(<Delivered layout="single" />);
    await userEvent.type(byLabel("Name"), "Sam");
    await userEvent.type(byLabel("Phone"), "0501234567");
    await userEvent.type(byLabel("Full address"), "1 Palm St");
    await userEvent.click(screen.getByRole("button", { name: "Pickup" }));
    await userEvent.click(screen.getByRole("button", { name: "Place order" }));
    await waitFor(() => expect(api.createOrder).toHaveBeenCalled());
    expect(api.createOrder.mock.calls[0][1]).toMatchObject({ orderType: "pickup", customerAddress: "Pickup at A", regionId: undefined });
  });

  it("saved-address picker is a delivery-only control", async () => {
    auth.customer = { name: "Sam", phone: "0501234567", email: "" };
    ctx.outlets = [outlet({ id: 1, deliveryEnabled: true, pickupEnabled: true })];
    render(<Delivered layout="single" />);
    await waitFor(() => expect(screen.getByText("Use a saved address")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Pickup" }));
    expect(screen.queryByText("Use a saved address")).not.toBeInTheDocument();
  });
});
