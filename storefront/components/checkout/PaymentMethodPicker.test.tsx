import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PaymentMethodPicker from "./PaymentMethodPicker";
import { NOMOD_CARD_LABEL, paymentLabel } from "./checkout-field-styles";

afterEach(cleanup);

describe("PaymentMethodPicker", () => {
  it("keeps the plain label when the card processor is not Nomod", () => {
    render(<PaymentMethodPicker methods={["card_online", "tabby"]} value="" onChange={() => {}} cardProcessor="stripe" />);
    expect(screen.getByText("Pay online (card)")).toBeInTheDocument();
    expect(screen.queryByText(NOMOD_CARD_LABEL)).not.toBeInTheDocument();
  });

  it("names Nomod for Pay online when Nomod is the card processor", () => {
    const onChange = vi.fn();
    render(<PaymentMethodPicker methods={["card_online", "cash_on_delivery"]} value="" onChange={onChange} cardProcessor="nomod" />);
    fireEvent.click(screen.getByText("Pay by card / Apple Pay / Tabby / Tamara (Nomod)"));
    expect(onChange).toHaveBeenCalledWith("card_online");
    // only the card option is renamed
    expect(screen.getByText("Cash on delivery")).toBeInTheDocument();
  });

  it("never renames Tabby or Tamara themselves", () => {
    expect(paymentLabel("tabby", "nomod")).toBe("Tabby");
    expect(paymentLabel("tamara", "nomod")).toBe("Tamara");
    expect(paymentLabel("card_online", null)).toBe("Pay online (card)");
    expect(paymentLabel("card_online", undefined)).toBe("Pay online (card)");
  });
});
