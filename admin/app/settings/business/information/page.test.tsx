import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BusinessInformationPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { getShop, updateShop } from "@/lib/api";
import type { Shop } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
  updateShop: vi.fn(),
  uploadShopLogo: vi.fn(),
  getPublishReadiness: vi.fn().mockResolvedValue({ ready: true, missing: [] }),
  getWhatsAppSettings: vi.fn().mockResolvedValue({ hasCredentials: false, maskedCredentials: null }),
  setWhatsAppCredentials: vi.fn(),
  clearWhatsAppCredentials: vi.fn(),
  resolveImageUrl: (path: string | null | undefined) => path || null,
  storefrontUrlFor: () => "https://example.com",
}));

const baseShop = {
  id: 1,
  name: "Jane's Flowers",
  subdomain: "janes-flowers",
  published: true,
  currency: "AED",
  displayName: null,
  legalName: null,
  trademarkFormat: "brand",
  logoUrl: null,
  email: null,
  whatsappCountryCode: "+971",
  whatsappNumber: null,
  description: null,
  country: null,
  address: null,
  timezone: "Asia/Dubai",
  notifyWhatsapp: false,
  notifyCustomersWhatsapp: false,
  notifyEmail: false,
  notifyAbandonedCart: false,
  abandonedCartWindowMinutes: 60,
  notifyLowStockDigest: false,
  autoDeductIngredientStock: true,
  productEditorMode: "simple",
} as unknown as Shop;

function renderPage() {
  return render(
    <ToastProvider>
      <BusinessInformationPage />
    </ToastProvider>,
  );
}

describe("Business Information — Product Editor field", () => {
  it("defaults to Simple, and saving Advanced calls updateShop with the new mode", async () => {
    const user = userEvent.setup();
    vi.mocked(getShop).mockResolvedValue(baseShop);
    vi.mocked(updateShop).mockResolvedValue(baseShop);
    renderPage();

    await waitFor(() => expect(screen.getByText("Product Editor")).toBeInTheDocument());
    const simpleButton = screen.getByText("Simple");
    expect(simpleButton.className).toMatch(/bg-accent/);

    await user.click(screen.getByText("Advanced"));
    await user.click(screen.getByText("Save changes"));

    await waitFor(() =>
      expect(updateShop).toHaveBeenCalledWith(expect.objectContaining({ productEditorMode: "advanced" })),
    );
  });
});
