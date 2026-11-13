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
vi.mock("@/components/NomodExtras", () => ({ default: () => null }));
import { getPaymentSettings, getShop, updatePaymentProvider } from "@/lib/api";
import { fireEvent } from "@testing-library/react";

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

const NOMOD_ROW = {
  provider: "nomod",
  enabled: false,
  isCardProcessor: true,
  hasCredentials: true,
  available: true,
  maskedCredentials: { apiKey: "••••1234", webhookSecret: "••••abcd" },
  publicValues: { baseUrl: "https://api.nomod.dev" },
  webhookPath: null,
};
const STRIPE_ROW = { provider: "stripe", enabled: true, isCardProcessor: true, hasCredentials: false, maskedCredentials: null };

describe("Payments page: Nomod", () => {
  beforeEach(() => {
    vi.mocked(getShop).mockResolvedValue({ currency: "AED" } as unknown as Shop);
  });

  it("is a 'Coming soon' row until the platform grants it to the shop", async () => {
    vi.mocked(getPaymentSettings).mockResolvedValue([
      STRIPE_ROW,
      { ...NOMOD_ROW, available: false, hasCredentials: false, maskedCredentials: null },
    ] as unknown as PaymentProviderSettings[]);
    render(<PaymentIntegrationsPage />);
    await screen.findByText("Card processing");
    // Telr and PayTabs are always "Coming soon"; Nomod joins them while ungranted
    expect(screen.getAllByText("Coming soon")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /Nomod/ })).toBeDisabled();
  });

  it("shows saved secrets only as masked tails, and a plain setting as saved", async () => {
    vi.mocked(getPaymentSettings).mockResolvedValue([
      { ...STRIPE_ROW, enabled: false },
      NOMOD_ROW,
    ] as unknown as PaymentProviderSettings[]);
    render(<PaymentIntegrationsPage />);
    await screen.findByText("Card processing");
    fireEvent.click(screen.getByRole("radio", { name: /Nomod/ }));
    expect(await screen.findByText("••••1234")).toBeInTheDocument();
    expect(screen.getByText("••••abcd")).toBeInTheDocument();
    // the base URL is a plain setting, shown as saved; no secret input is open
    expect(screen.getByDisplayValue("https://api.nomod.dev")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Replace" })).toHaveLength(2);
  });

  it("saving without touching a secret never sends one", async () => {
    vi.mocked(getPaymentSettings).mockResolvedValue([
      { ...STRIPE_ROW, enabled: false },
      NOMOD_ROW,
    ] as unknown as PaymentProviderSettings[]);
    vi.mocked(updatePaymentProvider).mockResolvedValue([] as unknown as PaymentProviderSettings[]);
    render(<PaymentIntegrationsPage />);
    await screen.findByText("Card processing");
    fireEvent.click(screen.getByRole("radio", { name: /Nomod/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Save card processor" }));
    await waitFor(() => expect(updatePaymentProvider).toHaveBeenCalled());
    const [provider, payload] = vi.mocked(updatePaymentProvider).mock.calls.at(-1)!;
    expect(provider).toBe("nomod");
    expect(payload.credentials).toBeUndefined();
  });

  it("a replaced secret is sent once and the field goes back to a mask after the save", async () => {
    vi.mocked(getPaymentSettings)
      .mockResolvedValueOnce([{ ...STRIPE_ROW, enabled: false }, NOMOD_ROW] as unknown as PaymentProviderSettings[])
      // after the save the server reports Nomod active, with only masks
      .mockResolvedValue([
        { ...STRIPE_ROW, enabled: false },
        { ...NOMOD_ROW, enabled: true, maskedCredentials: { apiKey: "••••-key", webhookSecret: "••••abcd" } },
      ] as unknown as PaymentProviderSettings[]);
    vi.mocked(updatePaymentProvider).mockResolvedValue([] as unknown as PaymentProviderSettings[]);
    render(<PaymentIntegrationsPage />);
    await screen.findByText("Card processing");
    fireEvent.click(screen.getByRole("radio", { name: /Nomod/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Replace" }))[0]);
    const input = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "brand-new-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save card processor" }));
    await waitFor(() => expect(updatePaymentProvider).toHaveBeenCalled());
    expect(vi.mocked(updatePaymentProvider).mock.calls.at(-1)![1].credentials).toEqual({ apiKey: "brand-new-key" });
    // the page reloads from the server, which only ever returns the mask
    await waitFor(() => expect(screen.queryByDisplayValue("brand-new-key")).not.toBeInTheDocument());
    expect(await screen.findByText("••••-key")).toBeInTheDocument();
  });
});
