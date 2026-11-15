import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCheckoutForm } from "@/lib/useCheckoutForm";
import CheckoutLayout from "./CheckoutLayout";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const cart = vi.hoisted(() => ({
  items: [
    { productId: 1, name: "Red roses", price: 50, quantity: 2, thumbnail: "https://x.test/r.jpg", variantLabel: "Large" },
    { productId: 2, name: "Vase", price: 25, quantity: 1, thumbnail: "https://x.test/v.jpg" },
  ] as Record<string, unknown>[],
}));
vi.mock("@/lib/cart", () => ({
  useCart: () => ({
    items: cart.items,
    subtotal: 125,
    discountCode: undefined,
    giftCardCode: undefined,
    outletId: 1,
    clear: vi.fn(),
  }),
}));
const auth = vi.hoisted(() => ({ customer: null as null | { name: string; phone: string; email: string } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ customer: auth.customer }) }));
const api = vi.hoisted(() => ({ createOrder: vi.fn(), quote: vi.fn() }));
vi.mock("@/lib/api", () => ({
  captureAbandonedCart: vi.fn().mockResolvedValue(undefined),
  createOrder: api.createOrder,
  listMyAddresses: vi.fn().mockResolvedValue([]),
  quoteDelivery: api.quote,
}));
const gift = vi.hoisted(() => ({ amount: 0 }));
vi.mock("@/components/MapPicker", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("./DeliveryDateCalendar", () => ({ default: () => <div data-testid="calendar" /> }));
vi.mock("@/components/PromoCodeField", () => ({ default: () => <div data-testid="promo" /> }));
vi.mock("@/components/GiftCardCodeField", async () => {
  const React = await import("react");
  return {
    default: function GiftCardMock({ onAmountChange }: { onAmountChange: (a: number | null) => void }) {
      React.useEffect(() => onAmountChange(gift.amount || null), [onAmountChange]);
      return <div data-testid="giftcard" />;
    },
  };
});
vi.mock("@/components/StoreCreditField", () => ({ default: () => <div data-testid="credit" /> }));
const shopCtx = vi.hoisted(() => ({
  regions: [{ id: 1, nameEn: "Dubai" }] as { id: number; nameEn: string }[],
}));
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shopSlug: "s",
    shopBasePath: "/s",
    regions: shopCtx.regions,
    regionLabel: "Emirate",
    shop: {
      currency: "AED",
      taxRate: "0",
      taxInclusive: false,
      deliveryPaymentCashOnDelivery: true,
      pickupPaymentCashOnPickup: true,
      deliveryPaymentCardOnline: true,
      deliveryPaymentCardOnDelivery: false,
      pickupPaymentCardOnline: false,
      pickupPaymentCardOnPickup: false,
      cardProcessorEnabled: true,
      cardProcessor: "stripe",
      enabledPaymentProviders: [],
      deliveryHours: null,
      pickupHours: null,
      deliveryTimeSlotGapMinutes: 60,
      pickupTimeSlotGapMinutes: 30,
      allowSameDayOrders: true,
      allowNextDayOrders: true,
    },
    outlets: [
      { id: 1, name: "Main", area: null, phone: null, deliveryEnabled: true, pickupEnabled: true, isOpen: true },
    ],
  }),
}));

function Page() {
  const state = useCheckoutForm();
  return <CheckoutLayout {...state} />;
}

// What the server quotes for this cart: discount, delivery and tax all present.
const QUOTE = {
  status: "quoted",
  reason: null,
  zone: null,
  currency: "AED",
  subtotal: "125.00",
  discountAmount: "12.50",
  discountCode: "SAVE10",
  taxAmount: "5.63",
  deliveryFee: "15.00",
  total: "133.13",
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.customer = null;
  gift.amount = 0;
  shopCtx.regions = [{ id: 1, nameEn: "Dubai" }];
  api.quote.mockImplementation(async (_s: string, req: { orderType: string }) =>
    req.orderType === "pickup"
      ? { ...QUOTE, status: "pickup_free", deliveryFee: "0.00", total: "118.13" }
      : QUOTE,
  );
  Element.prototype.scrollIntoView = vi.fn();
});

const column = (id: "checkout-details" | "checkout-summary-column") => within(screen.getByTestId(id));

describe("one page, two columns", () => {
  it("is one form with the details column and the summary column, a single copy of each", () => {
    render(<Page />);
    const form = screen.getByTestId("checkout-form");
    expect(form.querySelectorAll("[data-testid='checkout-summary']")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Place order" })).toHaveLength(1);
    expect(screen.getByTestId("checkout-details")).toBeInTheDocument();
    expect(screen.getByTestId("checkout-summary-column")).toBeInTheDocument();
  });

  it("two columns from lg, one column below it", () => {
    render(<Page />);
    const cls = screen.getByTestId("checkout-form").className;
    expect(cls).toMatch(/(^|\s)grid-cols-1(\s|$)/);
    expect(cls).toMatch(/lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,24rem\)\]/);
  });

  it("the summary card is sticky on desktop only", () => {
    render(<Page />);
    const cls = screen.getByTestId("checkout-summary-column").className;
    expect(cls).toContain("lg:sticky");
    expect(cls).not.toMatch(/(^|\s)sticky(\s|$)/);
    expect(cls).toContain("lg:max-h-");
  });

  it("uses logical properties only (it mirrors in RTL)", () => {
    const { container } = render(<Page />);
    expect(container.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\S+|text-(left|right)\b/);
  });
});

describe("left column: who, where, when", () => {
  it("holds the contact fields, fulfilment, address, schedule, notes and gift message", () => {
    render(<Page />);
    const left = column("checkout-details");
    for (const label of ["Name", "Phone", "Email (optional)", "Full address", "Notes (optional)", "Gift message (optional)"]) {
      expect(left.getByText(label)).toBeInTheDocument();
    }
    expect(left.getByRole("button", { name: "Delivery" })).toBeInTheDocument();
    expect(left.getByText("Delivery address")).toBeInTheDocument();
    expect(left.getByTestId("calendar")).toBeInTheDocument();
    expect(left.getByTestId("map")).toBeInTheDocument();
    // none of the order's money or payment lives here
    expect(left.queryByTestId("checkout-summary")).toBeNull();
    expect(left.queryByRole("button", { name: "Place order" })).toBeNull();
  });

  it("a guest sees a sign-in link, a signed-in customer sees who they are", () => {
    render(<Page />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/s/account/login");
    cleanup();
    auth.customer = { name: "Sam", phone: "0501234567", email: "" };
    render(<Page />);
    expect(screen.getByTestId("checkout-account-note")).toHaveTextContent("Signed in as Sam.");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});

describe("right column: the order", () => {
  it("lists the items with thumbnail, name, variant, quantity and line price", () => {
    render(<Page />);
    const items = column("checkout-summary-column").getByTestId("checkout-items");
    const rows = within(items).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Red roses")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Large")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/2 × 50\.00/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/100\.00/)).toBeInTheDocument();
    expect(rows[0].querySelector("img")).toHaveAttribute("src", "https://x.test/r.jpg");
    expect(within(rows[1]).getByText("Vase")).toBeInTheDocument();
  });

  it("holds the codes, the bill, the payment selector and Place order", () => {
    render(<Page />);
    const right = column("checkout-summary-column");
    expect(right.getByTestId("promo")).toBeInTheDocument();
    expect(right.getByTestId("giftcard")).toBeInTheDocument();
    expect(right.getByTestId("credit")).toBeInTheDocument();
    expect(right.getByTestId("checkout-summary")).toBeInTheDocument();
    expect(right.getByRole("button", { name: "Cash on delivery" })).toBeInTheDocument();
    expect(right.getByRole("button", { name: /Pay online/ })).toBeInTheDocument();
    expect(right.getByRole("button", { name: "Place order" })).toBeInTheDocument();
  });

  it("the payment options stack in the narrow card", () => {
    render(<Page />);
    const picker = column("checkout-summary-column").getByRole("button", { name: "Cash on delivery" }).parentElement!;
    expect(picker.className).toContain("grid-cols-1");
    expect(picker.className).not.toContain("grid-cols-2");
  });

  it("the bill is the server's quote: subtotal, discount, tax, delivery and total, with a gift card and cash on delivery", async () => {
    gift.amount = 20;
    render(<Page />);
    // The server quotes delivery once it knows where to.
    await userEvent.selectOptions(document.getElementById("checkout-region")!, "1");
    await userEvent.click(screen.getByRole("button", { name: "Cash on delivery" }));
    const summary = await screen.findByTestId("checkout-summary");
    await waitFor(() => expect(within(summary).getByTestId("checkout-total")).toBeInTheDocument());
    expect(within(summary).getByText("Subtotal").parentElement).toHaveTextContent("125.00");
    expect(within(summary).getByText("Discount").parentElement).toHaveTextContent("-12.50");
    expect(within(summary).getByText("Tax").parentElement).toHaveTextContent("5.63");
    expect(within(summary).getByTestId("checkout-delivery-row")).toHaveTextContent("15.00");
    expect(within(summary).getByTestId("checkout-total")).toHaveTextContent("133.13");
    // gift card and store credit are applied by the server at order time
    expect(within(summary).getByTestId("checkout-credit-note")).toBeInTheDocument();
    // cash on delivery is the selected method and nothing is added in the browser
    expect(screen.getByRole("button", { name: "Cash on delivery" })).toHaveAttribute("aria-pressed", "true");
  });

  it("the total is repeated right above Place order for a phone, from the same quote", async () => {
    render(<Page />);
    await userEvent.selectOptions(document.getElementById("checkout-region")!, "1");
    const compact = await screen.findByTestId("checkout-total-compact");
    await waitFor(() => expect(compact).toHaveTextContent("133.13"));
    expect(compact.className).toContain("lg:hidden");
    const button = screen.getByRole("button", { name: "Place order" });
    // it sits in the same block as the button, before it
    expect(compact.parentElement).toBe(button.parentElement);
    expect(compact.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pickup: no delivery fee in the bill, the pickup total", async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Pickup" }));
    const summary = screen.getByTestId("checkout-summary");
    await waitFor(() => expect(within(summary).getByTestId("checkout-total")).toHaveTextContent("118.13"));
    expect(within(summary).getByTestId("checkout-delivery-row")).toHaveTextContent("Free");
  });
});

describe("Place order waits for the required fields", () => {
  const place = () => screen.getByRole("button", { name: "Place order" });

  it("is disabled until name, phone, address and region are filled, and says what is missing", async () => {
    render(<Page />);
    expect(place()).toBeDisabled();
    const hint = screen.getByTestId("checkout-missing");
    for (const w of ["name", "phone", "full address", "emirate"]) expect(hint).toHaveTextContent(w);

    await userEvent.type(document.getElementById("checkout-name")!, "Sam");
    expect(place()).toBeDisabled();
    await userEvent.type(document.getElementById("checkout-phone")!, "0501234567");
    expect(place()).toBeDisabled();
    await userEvent.type(document.getElementById("checkout-address")!, "1 Palm St");
    expect(place()).toBeDisabled();
    await userEvent.selectOptions(document.getElementById("checkout-region")!, "1");
    await waitFor(() => expect(place()).toBeEnabled());
    expect(screen.queryByTestId("checkout-missing")).toBeNull();
  });

  it("pickup needs only name and phone", async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Pickup" }));
    expect(place()).toBeDisabled();
    await userEvent.type(document.getElementById("checkout-name")!, "Sam");
    await userEvent.type(document.getElementById("checkout-phone")!, "0501234567");
    await waitFor(() => expect(place()).toBeEnabled());
  });

  it("a country with no regions does not ask for one", async () => {
    shopCtx.regions = [];
    render(<Page />);
    await userEvent.type(document.getElementById("checkout-name")!, "Sam");
    await userEvent.type(document.getElementById("checkout-phone")!, "0501234567");
    await userEvent.type(document.getElementById("checkout-address")!, "1 Palm St");
    await waitFor(() => expect(place()).toBeEnabled());
  });

  it("the missing list takes you to the first field that needs filling", async () => {
    render(<Page />);
    await userEvent.click(within(screen.getByTestId("checkout-missing")).getByRole("button", { name: "phone" }));
    expect(document.activeElement).toBe(document.getElementById("checkout-phone"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("places the order with the gift message and everything else unchanged", async () => {
    api.createOrder.mockResolvedValue({ order: { id: 9, total: "133.13", currency: "AED", trackingToken: "T" }, checkoutUrl: null });
    render(<Page />);
    await userEvent.type(document.getElementById("checkout-name")!, "Sam");
    await userEvent.type(document.getElementById("checkout-phone")!, "0501234567");
    await userEvent.type(document.getElementById("checkout-address")!, "1 Palm St");
    await userEvent.selectOptions(document.getElementById("checkout-region")!, "1");
    await userEvent.type(document.getElementById("checkout-gift-message")!, "Happy birthday");
    await userEvent.click(screen.getByRole("button", { name: "Cash on delivery" }));
    await waitFor(() => expect(place()).toBeEnabled());
    fireEvent.click(place());
    await waitFor(() => expect(api.createOrder).toHaveBeenCalled());
    expect(api.createOrder.mock.calls[0][1]).toMatchObject({
      orderType: "delivery",
      paymentMethod: "cash_on_delivery",
      customerName: "Sam",
      customerAddress: "1 Palm St",
      regionId: 1,
      receiverMessage: "Happy birthday",
    });
  });
});
