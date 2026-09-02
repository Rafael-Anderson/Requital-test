import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";
import type { ShopDomainConfig } from "@/lib/types";
import DomainSettingsPage from "./page";

afterEach(cleanup);

// Partial mock: keep the real ApiError class (page.tsx does `instanceof ApiError`
// for the 409 branch), stub only the network functions.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getShopDomain: vi.fn(),
    updateShopDomain: vi.fn(),
    verifyShopDomain: vi.fn(),
  };
});
import {
  ApiError,
  getShopDomain,
  updateShopDomain,
  verifyShopDomain,
} from "@/lib/api";

function cfg(overrides: Partial<ShopDomainConfig> = {}): ShopDomainConfig {
  return {
    type: "subdomain",
    subdomain: "acme",
    customDomain: null,
    status: null,
    verification: null,
    storefrontUrl: "https://acme.requital.io",
    ...overrides,
  };
}

const PENDING = cfg({
  type: "custom",
  customDomain: "shop.acme.com",
  status: "pending",
  verification: {
    recordName: "_requital-verify.shop.acme.com",
    recordValue: "tok-123456",
  },
  storefrontUrl: "https://shop.acme.com",
});

function renderPage() {
  return render(
    <ToastProvider>
      <DomainSettingsPage />
    </ToastProvider>,
  );
}

describe("DomainSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subdomain-only: shows the requital.io address and a Connect form", async () => {
    vi.mocked(getShopDomain).mockResolvedValue(cfg());
    renderPage();

    expect(await screen.findByText("acme.requital.io")).toBeInTheDocument();
    expect(screen.getByText("Connect a custom domain")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("Connect calls updateShopDomain with the typed custom domain", async () => {
    const user = userEvent.setup();
    vi.mocked(getShopDomain).mockResolvedValue(cfg());
    vi.mocked(updateShopDomain).mockResolvedValue(PENDING);
    renderPage();

    await user.type(
      await screen.findByLabelText("Custom domain"),
      "shop.acme.com",
    );
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(updateShopDomain).toHaveBeenCalledWith({
        type: "custom",
        customDomain: "shop.acme.com",
      }),
    );
  });

  it("pending: shows the exact TXT record to add and a Verify now button", async () => {
    vi.mocked(getShopDomain).mockResolvedValue(PENDING);
    renderPage();

    expect(
      await screen.findByText("_requital-verify.shop.acme.com"),
    ).toBeInTheDocument();
    expect(screen.getByText("tok-123456")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Verify now" }),
    ).toBeInTheDocument();
  });

  it("Verify now calls verifyShopDomain and reflects the verified state after refetch", async () => {
    const user = userEvent.setup();
    vi.mocked(getShopDomain)
      .mockResolvedValueOnce(PENDING)
      .mockResolvedValue(
        cfg({
          type: "custom",
          customDomain: "shop.acme.com",
          status: "verified",
          verification: null,
          storefrontUrl: "https://shop.acme.com",
        }),
      );
    vi.mocked(verifyShopDomain).mockResolvedValue({
      status: "verified",
      verified: true,
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Verify now" }));

    await waitFor(() => expect(verifyShopDomain).toHaveBeenCalled());
    expect(
      await screen.findByText("Custom domain is live"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });

  it("verified: Disconnect asks for confirmation, then reverts to the subdomain", async () => {
    const user = userEvent.setup();
    vi.mocked(getShopDomain).mockResolvedValue(
      cfg({
        type: "custom",
        customDomain: "shop.acme.com",
        status: "verified",
        storefrontUrl: "https://shop.acme.com",
      }),
    );
    vi.mocked(updateShopDomain).mockResolvedValue(cfg());
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    // Confirmation modal — a second Disconnect button inside it.
    const confirm = await screen.findByText("Disconnect custom domain?");
    expect(confirm).toBeInTheDocument();
    const modalButtons = screen.getAllByRole("button", { name: "Disconnect" });
    await user.click(modalButtons[modalButtons.length - 1]);

    await waitFor(() =>
      expect(updateShopDomain).toHaveBeenCalledWith({ type: "subdomain" }),
    );
  });

  it("failed: shows the failure message and Retry re-arms the claim for the same domain", async () => {
    const user = userEvent.setup();
    vi.mocked(getShopDomain).mockResolvedValue(
      cfg({
        type: "custom",
        customDomain: "shop.acme.com",
        status: "failed",
        verification: {
          recordName: "_requital-verify.shop.acme.com",
          recordValue: "tok-old",
        },
        storefrontUrl: "https://shop.acme.com",
      }),
    );
    vi.mocked(updateShopDomain).mockResolvedValue(PENDING);
    renderPage();

    expect(
      await screen.findByText("Could not verify shop.acme.com"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Retry verification" }),
    );

    await waitFor(() =>
      expect(updateShopDomain).toHaveBeenCalledWith({
        type: "custom",
        customDomain: "shop.acme.com",
      }),
    );
  });

  it("409 on Connect: shows the specific 'connected to another account' message", async () => {
    const user = userEvent.setup();
    vi.mocked(getShopDomain).mockResolvedValue(cfg());
    vi.mocked(updateShopDomain).mockRejectedValue(
      new ApiError("That domain is already connected to another store.", 409),
    );
    renderPage();

    await user.type(
      await screen.findByLabelText("Custom domain"),
      "taken.example.com",
    );
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(
      await screen.findByText("This domain is connected to another account."),
    ).toBeInTheDocument();
  });
});
