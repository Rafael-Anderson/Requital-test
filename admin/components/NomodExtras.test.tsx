import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", () => ({
  API_URL: "http://api.test",
  getNomodPending: vi.fn(),
  nomodWebhookUrl: vi.fn(),
  nomodRotateWebhookUrl: vi.fn(),
  nomodTestConnection: vi.fn(),
  recheckNomodCheckout: vi.fn(),
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
import {
  getNomodPending,
  nomodRotateWebhookUrl,
  nomodTestConnection,
  nomodWebhookUrl,
  recheckNomodCheckout,
} from "@/lib/api";
import NomodExtras from "./NomodExtras";

const PATH = `/payments/webhook/nomod/${"a".repeat(64)}`;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNomodPending).mockResolvedValue([]);
});

describe("NomodExtras", () => {
  it("shows the shop webhook URL (API origin + path) and tells the owner to paste it into Nomod", async () => {
    render(<NomodExtras webhookPath={PATH} hasApiKey onChanged={() => {}} />);
    expect(await screen.findByText(`http://api.test${PATH}`)).toBeInTheDocument();
    expect(screen.getByText(/all 8 charge events/)).toBeInTheDocument();
    expect(screen.getByText(/whsec_ signing secret/)).toBeInTheDocument();
  });

  it("offers to generate the URL when none exists yet", async () => {
    vi.mocked(nomodWebhookUrl).mockResolvedValue({ webhookPath: PATH });
    const onChanged = vi.fn();
    render(<NomodExtras webhookPath={null} hasApiKey={false} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate webhook URL" }));
    expect(await screen.findByText(`http://api.test${PATH}`)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not rotate the URL unless the owner confirms", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NomodExtras webhookPath={PATH} hasApiKey onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate a new URL" }));
    expect(nomodRotateWebhookUrl).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    vi.mocked(nomodRotateWebhookUrl).mockResolvedValue({ webhookPath: `/payments/webhook/nomod/${"b".repeat(64)}` });
    fireEvent.click(screen.getByRole("button", { name: "Generate a new URL" }));
    expect(await screen.findByText(/b{64}/)).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("Test connection shows the server's plain answer and nothing else", async () => {
    vi.mocked(nomodTestConnection).mockResolvedValue({ ok: false, message: "Nomod rejected the API key." });
    render(<NomodExtras webhookPath={PATH} hasApiKey onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Nomod rejected the API key.")).toBeInTheDocument();
  });

  it("Test connection is disabled until an API key is saved", async () => {
    render(<NomodExtras webhookPath={PATH} hasApiKey={false} onChanged={() => {}} />);
    expect(await screen.findByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  it("says plainly that partial refunds are off by default and undocumented", async () => {
    render(<NomodExtras webhookPath={PATH} hasApiKey onChanged={() => {}} />);
    expect(await screen.findByText(/does not document partial refunds/)).toBeInTheDocument();
    expect(screen.getByText(/only a refund of the whole charge goes\s+through Nomod/)).toBeInTheDocument();
  });

  it("lists payments that need a look and rechecks one", async () => {
    vi.mocked(getNomodPending).mockResolvedValue([
      {
        id: 7,
        orderId: 3,
        shopOrderNumber: 12,
        status: "review",
        reviewReason: "amount_mismatch",
        disputed: false,
        amount: "50.00",
        currency: "AED",
        createdAt: "2026-11-13T10:00:00Z",
        lastCheckedAt: null,
      },
    ]);
    vi.mocked(recheckNomodCheckout).mockResolvedValue({ outcome: "unpaid" });
    render(<NomodExtras webhookPath={PATH} hasApiKey onChanged={() => {}} />);
    expect(await screen.findByText(/Order #12, 50.00 AED/)).toBeInTheDocument();
    expect(screen.getByText(/did not match the order, not marked paid/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check with Nomod" }));
    await waitFor(() => expect(recheckNomodCheckout).toHaveBeenCalledWith(7));
  });
});
