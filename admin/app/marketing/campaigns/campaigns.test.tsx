import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CampaignsPage from "./page";
import CampaignDetailPage from "./[id]/page";
import { cancelCampaign, getCampaign, getCampaignAudience, getCampaignStatus, listCampaigns, sendCampaign, sendCampaignTest } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  listCampaigns: vi.fn(),
  getCampaign: vi.fn(),
  getCampaignStatus: vi.fn(),
  getCampaignAudience: vi.fn(),
  sendCampaign: vi.fn(),
  sendCampaignTest: vi.fn(),
  cancelCampaign: vi.fn(),
  updateCampaign: vi.fn(),
  createCampaign: vi.fn(),
  listCustomerSegments: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { role: "admin" }, loading: false }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: "7" }),
  usePathname: () => "/marketing/campaigns",
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));

const COUNTS = { pending: 0, sent: 0, skipped: 0, failed: 0 };
const DRAFT = {
  id: 7,
  name: "Spring",
  subject: "Spring offers",
  bodyHtml: "<p>Hello</p>",
  segmentId: null,
  status: "draft" as const,
  audienceCount: null,
  failureReason: null,
  sendingStartedAt: null,
  completedAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  counts: COUNTS,
};
const READY = { enabled: true, sendingDomainVerified: true, fromAddress: "hello@shop.test", dailyCap: 500, sentLast24Hours: 0 };

beforeEach(() => {
  vi.mocked(getCampaignStatus).mockResolvedValue(READY);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Campaigns list", () => {
  it("ends in a retryable error, never a permanent skeleton, when the request fails", async () => {
    vi.mocked(listCampaigns).mockRejectedValueOnce(new Error("boom")).mockResolvedValue([DRAFT]);
    render(<CampaignsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Spring")).toBeInTheDocument();
  });

  it("says the feature is off, and offers no create button", async () => {
    vi.mocked(getCampaignStatus).mockResolvedValue({ ...READY, enabled: false });
    vi.mocked(listCampaigns).mockRejectedValue(new Error("403"));
    render(<CampaignsPage />);
    expect(await screen.findByText(/not enabled for your shop/)).toBeInTheDocument();
    expect(screen.queryByText("New campaign")).toBeNull();
  });
});

describe("Campaign detail", () => {
  beforeEach(() => {
    vi.mocked(getCampaign).mockResolvedValue(DRAFT);
  });

  it("renders the preview in a sandboxed frame with no permissions", async () => {
    render(<CampaignDetailPage />);
    const frame = (await screen.findByTitle("Email preview")) as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
  });

  it("sends only after the confirmation, showing the audience count first", async () => {
    vi.mocked(getCampaignAudience).mockResolvedValue({ count: 12 });
    vi.mocked(sendCampaign).mockResolvedValue({ ...DRAFT, status: "sending", audienceCount: 12 });
    render(<CampaignDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Send campaign" }));
    expect(await screen.findByText(/will email 12 people who agreed/)).toBeInTheDocument();
    expect(sendCampaign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    await waitFor(() => expect(sendCampaign).toHaveBeenCalledWith(7));
  });

  it("cannot send without a verified sending domain, and says why", async () => {
    vi.mocked(getCampaignStatus).mockResolvedValue({ ...READY, sendingDomainVerified: false, fromAddress: null });
    render(<CampaignDetailPage />);
    expect(await screen.findByRole("button", { name: "Send campaign" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send test to me" })).toBeDisabled();
    expect(screen.getAllByText(/verified/i).length).toBeGreaterThan(0);
  });

  it("send test uses the campaign id only (no recipient is chosen)", async () => {
    vi.mocked(sendCampaignTest).mockResolvedValue({ sent: true });
    render(<CampaignDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Send test to me" }));
    await waitFor(() => expect(sendCampaignTest).toHaveBeenCalledWith(7));
  });

  it("a sent campaign is read only: counts, no editor, no send", async () => {
    vi.mocked(getCampaign).mockResolvedValue({ ...DRAFT, status: "sent", audienceCount: 3, counts: { pending: 0, sent: 2, skipped: 1, failed: 0 } });
    render(<CampaignDetailPage />);
    expect(await screen.findByText("Skipped")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send campaign" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(cancelCampaign).not.toHaveBeenCalled();
  });

  it("a failed load offers Try again", async () => {
    vi.mocked(getCampaign).mockRejectedValueOnce(new Error("x")).mockResolvedValue(DRAFT);
    render(<CampaignDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByTitle("Email preview")).toBeInTheDocument();
  });
});
