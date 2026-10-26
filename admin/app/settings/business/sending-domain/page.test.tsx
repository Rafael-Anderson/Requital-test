import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";
import type { SendingDomain } from "@/lib/types";
import SendingDomainSettingsPage from "./page";

afterEach(cleanup);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSendingDomain: vi.fn(),
    putSendingDomain: vi.fn(),
    verifySendingDomain: vi.fn(),
    deleteSendingDomain: vi.fn(),
  };
});
import {
  ApiError,
  deleteSendingDomain,
  getSendingDomain,
  putSendingDomain,
  verifySendingDomain,
} from "@/lib/api";

const PENDING: SendingDomain = {
  domain: "mail.acme.com",
  status: "pending",
  fromAddress: "noreply@mail.acme.com",
  records: [
    { type: "TXT", name: "k._domainkey.mail.acme.com", value: "p=KEY", label: "DKIM" },
    { type: "MX", name: "send.mail.acme.com", value: "feedback.example", priority: 10 },
  ],
  lastError: null,
  verifiedAt: null,
};

function renderPage() {
  return render(
    <ToastProvider>
      <SendingDomainSettingsPage />
    </ToastProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("Sending domain settings page", () => {
  it("shows an error with Try again when the first load fails, then recovers", async () => {
    vi.mocked(getSendingDomain).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(getSendingDomain).mockResolvedValueOnce({ sendingDomain: null });
    renderPage();
    const retry = await screen.findByRole("button", { name: /try again/i });
    await userEvent.click(retry);
    expect(await screen.findByLabelText("Domain")).toBeTruthy();
  });

  it("adds a domain and shows the DNS records with copy buttons and a status badge", async () => {
    vi.mocked(getSendingDomain).mockResolvedValue({ sendingDomain: null });
    vi.mocked(putSendingDomain).mockResolvedValue(PENDING);
    renderPage();
    await userEvent.type(await screen.findByLabelText("Domain"), "mail.acme.com");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(putSendingDomain).toHaveBeenCalledWith("mail.acme.com");
    expect(await screen.findByText("Pending")).toBeTruthy();
    expect(screen.getByText("p=KEY")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Copy / }).length).toBe(4);
    expect(screen.getByRole("button", { name: "Verify now" })).toBeTruthy();
  });

  it("puts a server rejection (e.g. free-mail domain) next to the field", async () => {
    vi.mocked(getSendingDomain).mockResolvedValue({ sendingDomain: null });
    vi.mocked(putSendingDomain).mockRejectedValue(
      new ApiError("Free mailbox domains cannot be used. Use a domain you own.", 400),
    );
    renderPage();
    await userEvent.type(await screen.findByLabelText("Domain"), "gmail.com");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Free mailbox domains cannot be used/)).toBeTruthy();
  });

  it("verify now reloads and removal returns to the empty form", async () => {
    vi.mocked(getSendingDomain).mockResolvedValue({ sendingDomain: PENDING });
    vi.mocked(verifySendingDomain).mockResolvedValue({ status: "verified", verified: true });
    vi.mocked(deleteSendingDomain).mockResolvedValue({ removed: true });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Verify now" }));
    await waitFor(() => expect(verifySendingDomain).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    const buttons = await screen.findAllByRole("button", { name: "Remove" });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(deleteSendingDomain).toHaveBeenCalled());
    expect(await screen.findByLabelText("Domain")).toBeTruthy();
  });

  it("verified state names the From address and offers no Verify now", async () => {
    vi.mocked(getSendingDomain).mockResolvedValue({
      sendingDomain: { ...PENDING, status: "verified", verifiedAt: "2026-10-26T00:00:00Z" },
    });
    renderPage();
    expect(await screen.findByText("Verified")).toBeTruthy();
    expect(screen.getByText("noreply@mail.acme.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify now" })).toBeNull();
  });
});
