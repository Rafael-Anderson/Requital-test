import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import WhatsAppConnectionResult from "./WhatsAppConnectionResult";

describe("WhatsAppConnectionResult", () => {
  it("shows the display number and verified name, with no mismatch warning when they agree", () => {
    render(
      <WhatsAppConnectionResult
        result={{ ok: true, displayPhoneNumber: "+971 50 123 4567", verifiedName: "Rose Shop" }}
        countryCode="+971"
        localNumber="501234567"
      />,
    );
    expect(screen.getByTestId("whatsapp-connection-ok").textContent).toContain("+971 50 123 4567");
    expect(screen.getByTestId("whatsapp-connection-ok").textContent).toContain("Rose Shop");
    expect(screen.queryByTestId("whatsapp-number-mismatch")).toBeNull();
  });

  it("warns when the display number differs from the WhatsApp Number field", () => {
    render(
      <WhatsAppConnectionResult
        result={{ ok: true, displayPhoneNumber: "+971 55 000 0000", verifiedName: "Rose Shop" }}
        countryCode="+971"
        localNumber="501234567"
      />,
    );
    expect(screen.getByTestId("whatsapp-number-mismatch")).toBeTruthy();
  });

  it("shows the friendly message and Meta's details on failure", () => {
    render(
      <WhatsAppConnectionResult
        result={{
          ok: false,
          reason: "phone_number_id_not_found",
          message: "Meta could not find this Phone Number ID.",
          details: { metaMessage: "Unsupported get request.", fbtraceId: "AbC123", code: 100, subcode: 33, status: 400 },
        }}
        countryCode="+971"
        localNumber="501234567"
      />,
    );
    const box = screen.getByTestId("whatsapp-connection-failed");
    expect(box.textContent).toContain("Meta could not find this Phone Number ID.");
    expect(box.textContent).toContain("Unsupported get request.");
    expect(box.textContent).toContain("AbC123");
  });
});
