import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import PaymentIntegrationsPage from "./page";
import type { PaymentProviderSettings, Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  API_URL: "http://api.test",
  getPaymentSettings: vi.fn(),
  getShop: vi.fn(),
  updatePaymentProvider: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { shopId: 1 } }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
import { getPaymentSettings, getShop } from "@/lib/api";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPaymentSettings).mockResolvedValue([
    { provider: "stripe", enabled: true, isCardProcessor: true, maskedCredentials: null },
  ] as unknown as PaymentProviderSettings[]);
});

describe("Payments page Stripe currency warning", () => {
  it.each(["KWD", "BHD", "OMR"])("warns on a %s shop", async (currency) => {
    vi.mocked(getShop).mockResolvedValue({ currency } as unknown as Shop);
    render(<PaymentIntegrationsPage />);
    expect(await screen.findByText(/Card payments through Stripe are unavailable/)).toBeInTheDocument();
  });

  it("does not warn on an AED shop", async () => {
    vi.mocked(getShop).mockResolvedValue({ currency: "AED" } as unknown as Shop);
    render(<PaymentIntegrationsPage />);
    await screen.findByText("Card processing");
    await waitFor(() => expect(getShop).toHaveBeenCalled());
    expect(screen.queryByText(/Card payments through Stripe are unavailable/)).not.toBeInTheDocument();
  });
});
