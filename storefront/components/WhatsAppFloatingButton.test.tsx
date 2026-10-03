import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WhatsAppFloatingButton from "./WhatsAppFloatingButton";

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    shop: { whatsappCountryCode: "971", whatsappNumber: "501234567", whatsappFloatingButtonEnabled: true },
    themeConfig: null,
  }),
}));

afterEach(cleanup);

describe("WhatsAppFloatingButton", () => {
  it("offsets its bottom by the cookie banner height so it never sits under the banner", () => {
    render(<WhatsAppFloatingButton />);
    expect(screen.getByLabelText("Chat with us on WhatsApp").className).toContain("bottom-[calc(1.25rem+var(--bottom-nav-h,0px)+var(--cookie-banner-h,0px))]");
  });
});
