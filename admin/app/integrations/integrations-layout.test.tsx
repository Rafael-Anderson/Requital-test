import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/api", () => ({
  API_URL: "http://api.test",
  getSliderSettings: vi.fn().mockResolvedValue({ status: "active", enabled: true }),
  updateSliderSettings: vi.fn(),
  getPaymentSettings: vi.fn().mockResolvedValue([
    { provider: "stripe", enabled: true, isCardProcessor: true, hasCredentials: false, maskedCredentials: null },
    { provider: "nomod", enabled: false, isCardProcessor: true, hasCredentials: false, maskedCredentials: null, available: false },
    { provider: "cod", enabled: false, isCardProcessor: false, hasCredentials: false, maskedCredentials: null },
  ]),
  getShop: vi.fn().mockResolvedValue({ currency: "AED" }),
  updatePaymentProvider: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { shopId: 1, role: "admin" } }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/WebhookActivityPanel", () => ({ default: () => <div>activity</div> }));
import PaymentIntegrationsPage from "./payments/page";
import WebhooksIntegrationsPage from "./webhooks/page";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("Integrations pages share the card grid", () => {
  it("Payments lays its cards out in the two-column grid, Stripe webhook URL in its own card", async () => {
    render(<PaymentIntegrationsPage />);
    await screen.findByText("Card processing");
    const grid = screen.getByTestId("card-grid");
    expect(grid.className).toContain("lg:grid-cols-2");
    // more than one card flows in the grid: processor, webhook, PayPal, Tabby, Tamara, COD
    expect(grid.children.length).toBeGreaterThanOrEqual(6);
    const url = screen.getByTitle("http://api.test/payments/webhook/stripe/1");
    // the URL truncates (never overflows) and keeps its full value in the title
    expect(url.className).toContain("truncate");
    expect(url.className).toContain("min-w-0");
    expect(screen.getByRole("button", { name: /Copy/ }).className).toContain("shrink-0");
    // Nomod stays "Coming soon" until the platform grants it
    expect(screen.getByRole("radio", { name: /Nomod/ })).toBeDisabled();
  });

  it("the wide Webhooks table is full width (the wide PageShell, no 4xl cap)", () => {
    const { container } = render(<WebhooksIntegrationsPage />);
    expect(container.firstElementChild?.className).not.toContain("max-w-4xl");
  });
});
