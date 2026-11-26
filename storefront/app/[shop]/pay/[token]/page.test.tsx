import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomOrderPayPage from "./page";
import { HttpError } from "@/lib/api";
import type { CustomOrderPay } from "@/lib/types";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useParams: () => ({ shop: "rose", token: "a".repeat(32) }),
}));
vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({ shopBasePath: "/rose" }),
}));
vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>();
  return { HttpError: real.HttpError, getCustomOrderPay: vi.fn(), startCustomOrderPay: vi.fn() };
});

import { getCustomOrderPay, startCustomOrderPay } from "@/lib/api";

const base = (over: Partial<CustomOrderPay> = {}): CustomOrderPay => ({
  state: "payable",
  shop: { name: "Rose Shop", phone: "+971501112233", email: null },
  bill: {
    currency: "AED",
    taxInclusive: false,
    lines: [{ name: "Hand-written card", variantLabel: null, quantity: 1, unitPrice: "10", lineTotal: "10" }],
    subtotal: "10",
    discount: { amount: "0", code: null },
    deliveryFee: "15",
    taxAmount: "1.25",
    total: "26.25",
  },
  fulfilment: {
    orderType: "delivery",
    customerName: "Layla",
    customerAddress: "Villa 7",
    regionName: "Dubai",
    area: null,
    deliveryDate: "2030-01-02",
    deliveryTimeSlot: null,
    receiverName: "Mona",
    receiverPhone: "0502223344",
    receiverMessage: "Happy birthday",
    customerNote: null,
    outletName: "Main",
  },
  expiresAt: null,
  order: null,
  ...over,
});

describe("custom order pay page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the bill and receiver, and Pay redirects to the gateway session", async () => {
    vi.mocked(getCustomOrderPay).mockResolvedValue(base());
    vi.mocked(startCustomOrderPay).mockResolvedValue({ checkoutUrl: "https://gateway.example/s/1" } as never);
    const hrefs: string[] = [];
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, set href(v: string) { hrefs.push(v); } },
    });
    render(<CustomOrderPayPage />);
    await screen.findByTestId("pay-state-payable");
    expect(screen.getByText(/Hand-written card/)).toBeInTheDocument();
    expect(screen.getByText(/Receiver: Mona/)).toBeInTheDocument();
    expect(screen.getByText(/Gift message: Happy birthday/)).toBeInTheDocument();
    expect(startCustomOrderPay).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Pay" }));
    expect(startCustomOrderPay).toHaveBeenCalledWith("rose", "a".repeat(32));
    expect(hrefs).toEqual(["https://gateway.example/s/1"]);
  });

  it("paid shows the order number and a tracking link, with no Pay button", async () => {
    vi.mocked(getCustomOrderPay).mockResolvedValue(base({ state: "paid", order: { shopOrderNumber: 42, trackingToken: "B".repeat(32) } }));
    render(<CustomOrderPayPage />);
    await screen.findByTestId("pay-state-paid");
    expect(screen.getByText(/your order is #42/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Track your order" })).toHaveAttribute("href", `/rose/orders/${"B".repeat(32)}`);
    expect(screen.queryByRole("button", { name: "Pay" })).toBeNull();
  });

  it("unavailable tells the customer to contact the shop and offers no Pay", async () => {
    vi.mocked(getCustomOrderPay).mockResolvedValue(base({ state: "unavailable" }));
    render(<CustomOrderPayPage />);
    await screen.findByTestId("pay-state-unavailable");
    expect(screen.getByText(/Card payment is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay" })).toBeNull();
  });

  it("an unknown token renders the not-found state", async () => {
    vi.mocked(getCustomOrderPay).mockRejectedValue(new HttpError("Not found", 404));
    render(<CustomOrderPayPage />);
    expect(await screen.findByTestId("pay-state-notfound")).toBeInTheDocument();
  });
});
