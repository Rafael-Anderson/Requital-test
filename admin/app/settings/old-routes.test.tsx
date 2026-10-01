import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings",
}));
vi.mock("@/lib/api", () => ({
  getWebhookLog: vi.fn(),
  listFailedJobs: vi.fn(),
  retryFailedJob: vi.fn(),
  dismissFailedJob: vi.fn(),
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
import { getWebhookLog, listFailedJobs, retryFailedJob } from "@/lib/api";

import BusinessIndexPage from "./business/page";
import FailedJobsMovedPage from "./jobs/page";
import PaymentsMovedPage from "./business/payments/page";
import DeliveryProvidersMovedPage from "./business/delivery-providers/page";
import DiagnosticsPage from "./diagnostics/page";
import SettingsIndexPage from "./page";
import nextConfig from "../../next.config";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

// Old routes keep resolving (audit §14.6). Bookmarks to /settings/business/*
// and /settings/jobs must land somewhere explanatory, never a 404.
describe("old Settings routes", () => {
  it("/settings/business still lands on Business Information", () => {
    BusinessIndexPage();
    expect(redirect).toHaveBeenCalledWith("/settings/business/information");
  });

  it("/settings/jobs is a pointer card to Diagnostics", () => {
    render(<FailedJobsMovedPage />);
    expect(screen.getByText(/Failed jobs have moved to Diagnostics/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to Diagnostics/ })).toHaveAttribute("href", "/settings/diagnostics");
  });

  it("the earlier Integrations pointers keep their original copy", () => {
    render(<PaymentsMovedPage />);
    expect(screen.getByText("Payment and integration settings have moved to Integrations.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Integrations" })).toHaveAttribute("href", "/integrations/payments");
    cleanup();
    render(<DeliveryProvidersMovedPage />);
    expect(screen.getByRole("link", { name: "Go to Integrations" })).toHaveAttribute("href", "/integrations");
  });

  it("the legacy top-level /jobs redirect goes straight to Diagnostics", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/jobs", destination: "/settings/diagnostics", permanent: true });
  });
});

describe("Diagnostics", () => {
  it("shows webhook activity and failed jobs from the existing endpoints, and retries a job", async () => {
    const user = userEvent.setup();
    vi.mocked(getWebhookLog).mockResolvedValue([
      { id: 1, source: "stripe", eventType: "payment_intent_succeeded", result: "success", createdAt: "2026-10-01T10:00:00Z" },
    ] as never);
    vi.mocked(listFailedJobs).mockResolvedValue([
      { id: 7, type: "send_email", lastError: "boom", attempts: 5, maxAttempts: 5, updatedAt: "2026-10-01T10:00:00Z" },
    ] as never);
    vi.mocked(retryFailedJob).mockResolvedValue(undefined);

    render(<DiagnosticsPage />);
    expect(await screen.findByText("Stripe")).toBeInTheDocument();
    expect(await screen.findByText("send_email")).toBeInTheDocument();
    expect(screen.getByText("Failed Jobs")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry job 7" }));
    await waitFor(() => expect(retryFailedJob).toHaveBeenCalledWith(7));
  });
});

describe("Settings landing page", () => {
  it("lists every group, and searching replaces the groups with matching settings", async () => {
    const user = userEvent.setup();
    render(<SettingsIndexPage />);
    for (const group of ["Business", "Selling", "Fulfilment", "Outlets", "Storefront", "Team", "Integrations", "Diagnostics"]) {
      expect(screen.getByRole("heading", { name: group })).toBeInTheDocument();
    }

    await user.type(screen.getByLabelText("Search settings"), "vat");
    const results = screen.getByRole("list", { name: "Search results" });
    expect(results).toHaveTextContent("Tax rate");
    expect(screen.getByRole("link", { name: /Tax rate/ })).toHaveAttribute("href", "/settings/selling/money-tax");
    expect(screen.queryByRole("heading", { name: "Fulfilment" })).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<SettingsIndexPage />);
    await user.type(screen.getByLabelText("Search settings"), "qqqq");
    expect(screen.getByText(/No settings match/)).toBeInTheDocument();
  });
});
