import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CheckoutFormState } from "@/lib/useCheckoutForm";
import type { DeliveryQuote } from "@/lib/api";
import type { DeliveryQuoteState } from "@/lib/useDeliveryQuote";
import CheckoutSummary from "./CheckoutSummary";

afterEach(cleanup);

const quote = (over: Partial<DeliveryQuote> = {}): DeliveryQuote => ({
  status: "quoted", reason: null, zone: "Dubai", currency: "AED", subtotal: "100", discountAmount: "10",
  discountCode: "X", taxAmount: "4.5", deliveryFee: "30", total: "124.5", ...over,
});

function summary(deliveryQuote: DeliveryQuoteState, over: Partial<CheckoutFormState> = {}, retry = vi.fn()) {
  const state = {
    shop: { currency: "AED", taxInclusive: false },
    subtotal: 100,
    taxQuote: { taxAmount: 5, estimated: false, empty: false },
    discountAmount: null,
    giftCardAmount: null,
    orderType: "delivery",
    deliveryQuote,
    retryDeliveryQuote: retry,
    ...over,
  } as unknown as CheckoutFormState;
  render(<CheckoutSummary state={state} />);
  return retry;
}

describe("CheckoutSummary", () => {
  it("shows the server's subtotal, discount, tax, delivery and a total that includes delivery", () => {
    summary({ phase: "ready", quote: quote() });
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("124.50");
    expect(screen.getByTestId("checkout-delivery-row")).toHaveTextContent("30.00");
    expect(screen.getByText("Discount").parentElement).toHaveTextContent("-10.00");
    expect(screen.getByText("Tax").parentElement).toHaveTextContent("4.50");
    expect(screen.queryByText(/before delivery/i)).toBeNull();
  });

  it("uses the shop currency's decimals (KWD three) for the server figures", () => {
    summary({ phase: "ready", quote: quote({ currency: "KWD", discountAmount: "0", deliveryFee: "1.505", total: "34.596" }) }, {
      shop: { currency: "KWD", taxInclusive: false },
    } as Partial<CheckoutFormState>);
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("34.596");
    expect(screen.getByTestId("checkout-delivery-row")).toHaveTextContent("1.505");
  });

  it("says the fee is calculated after the address and withholds the total until a quote exists", () => {
    summary({ phase: "idle" });
    expect(screen.getByTestId("checkout-delivery-row")).toHaveTextContent("Calculated after you choose your address");
    expect(screen.getByTestId("checkout-total-row")).toHaveTextContent("To be confirmed");
    expect(screen.getByTestId("checkout-delivery-row")).not.toHaveTextContent(/\b0\.00\b/);
  });

  it("shows Free for pickup", () => {
    summary({ phase: "ready", quote: quote({ status: "pickup_free", deliveryFee: "0", discountAmount: "0", total: "105" }) }, {
      orderType: "pickup",
    } as Partial<CheckoutFormState>);
    expect(screen.getByTestId("checkout-delivery-row")).toHaveTextContent("Free");
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("105.00");
  });

  it("shows a busy placeholder on the delivery and total rows while quoting", () => {
    summary({ phase: "loading" });
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
  });

  it("shows the server's reason inline when delivery is unavailable", () => {
    summary({ phase: "ready", quote: quote({ status: "unavailable", reason: "This address is outside the outlet’s delivery radius", deliveryFee: null, total: null }) });
    expect(screen.getByRole("alert")).toHaveTextContent("outside the outlet’s delivery radius");
    expect(screen.getByTestId("checkout-total-row")).toHaveTextContent("To be confirmed");
  });

  it("offers Retry when the quote call fails", () => {
    const retry = summary({ phase: "error", message: "boom" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("applies a gift card after the server total", () => {
    summary({ phase: "ready", quote: quote() }, { giftCardAmount: 24.5 } as Partial<CheckoutFormState>);
    expect(screen.getByText("Amount due").parentElement).toHaveTextContent("100.00");
  });
});
