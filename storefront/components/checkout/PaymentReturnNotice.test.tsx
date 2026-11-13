import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { checkoutAttemptKey } from "@/lib/checkout-attempt";
import PaymentReturnNotice from "./PaymentReturnNotice";

afterEach(cleanup);
beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, "", "/checkout");
});

describe("PaymentReturnNotice", () => {
  it("says the order is saved when the gateway cancel link returns a shopper who just submitted", async () => {
    await checkoutAttemptKey("shop", "sig");
    window.history.pushState({}, "", "/checkout?orderId=12");
    render(<PaymentReturnNotice shopSlug="shop" />);
    expect(screen.getByRole("status").textContent).toMatch(/not completed/i);
    expect(screen.getByRole("status").textContent).not.toContain("—");
  });

  it("words a Nomod failure and a Nomod cancel differently (wording only, never proof of anything)", async () => {
    await checkoutAttemptKey("shop", "sig");
    window.history.pushState({}, "", "/checkout?orderId=12&payment=failed");
    const { rerender } = render(<PaymentReturnNotice shopSlug="shop" />);
    expect(screen.getByRole("status").textContent).toMatch(/did not go through/i);
    window.history.pushState({}, "", "/checkout?orderId=12&payment=cancelled");
    rerender(<PaymentReturnNotice key="again" shopSlug="shop" />);
    expect(screen.getByRole("status").textContent).toMatch(/You cancelled the payment/);
    expect(screen.getByRole("status").textContent).toMatch(/not be charged twice/);
    expect(screen.getByRole("status").textContent).not.toContain("—");
  });

  it("shows nothing without orderId in the URL, or without an attempt in this tab", async () => {
    await checkoutAttemptKey("shop", "sig");
    const { container, rerender } = render(<PaymentReturnNotice shopSlug="shop" />);
    expect(container.textContent).toBe("");
    window.history.pushState({}, "", "/checkout?orderId=12");
    sessionStorage.clear();
    rerender(<PaymentReturnNotice shopSlug="shop" />);
    expect(container.textContent).toBe("");
  });
});
