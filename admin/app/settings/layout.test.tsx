import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const replace = vi.fn();
let pathname = "/settings";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
}));

vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));

let auth: { user: { role: string } | null; loading: boolean } = { user: null, loading: false };
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth }));

// Every page under /settings that fetches on mount. If the layout let a
// non-admin through, one of these would call its endpoint.
vi.mock("@/lib/api", () => ({
  getShop: vi.fn().mockResolvedValue({}),
  updateShop: vi.fn(),
  getWebhookLog: vi.fn().mockResolvedValue([]),
  listFailedJobs: vi.fn().mockResolvedValue([]),
  retryFailedJob: vi.fn(),
  dismissFailedJob: vi.fn(),
}));
import { getShop, getWebhookLog, listFailedJobs } from "@/lib/api";

import SettingsLayout from "./layout";
import SettingsIndexPage from "./page";
import MoneyTaxPage from "./selling/money-tax/page";
import FulfilmentDeliveryPage from "./fulfilment/delivery/page";
import FulfilmentPickupPage from "./fulfilment/pickup/page";
import StorefrontDisplayPage from "./storefront/display/page";
import DiagnosticsPage from "./diagnostics/page";
import FailedJobsMovedPage from "./jobs/page";

const has = (m: string) => !!(screen.queryByText(m) ?? screen.queryByLabelText(m));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  pathname = "/settings";
  auth = { user: null, loading: false };
});

// The role gate for every route added by the Settings IA restructure. The gate
// is the shared layout, so each new page is rendered INSIDE it.
const NEW_ROUTES: [string, () => React.ReactElement, string][] = [
  ["/settings", () => <SettingsIndexPage />, "Search settings"],
  ["/settings/selling/money-tax", () => <MoneyTaxPage />, "Tax Rate (%)"],
  ["/settings/fulfilment/delivery", () => <FulfilmentDeliveryPage />, "Delivery Settings"],
  ["/settings/fulfilment/pickup", () => <FulfilmentPickupPage />, "Pickup Settings"],
  ["/settings/storefront/display", () => <StorefrontDisplayPage />, "Storefront Display"],
  ["/settings/diagnostics", () => <DiagnosticsPage />, "Webhook activity"],
  ["/settings/jobs", () => <FailedJobsMovedPage />, "Go to Diagnostics"],
];

describe("Settings layout role gate", () => {
  describe.each(["branch", "viewer", "order_manager"])("as %s", (role) => {
    it.each(NEW_ROUTES)("%s renders nothing, fetches nothing and redirects home", (route, page, marker) => {
      auth = { user: { role }, loading: false };
      pathname = route;
      render(<SettingsLayout>{page()}</SettingsLayout>);
      expect(has(marker)).toBe(false);
      expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
      expect(getShop).not.toHaveBeenCalled();
      expect(getWebhookLog).not.toHaveBeenCalled();
      expect(listFailedJobs).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledWith("/");
    });
  });

  describe.each(["branch", "viewer", "order_manager", "admin"])("own security page as %s", (role) => {
    it("is reachable by every staff role, without the admin sidebar for non-admins", () => {
      auth = { user: { role }, loading: false };
      pathname = "/settings/security";
      render(
        <SettingsLayout>
          <div>security page body</div>
        </SettingsLayout>,
      );
      expect(screen.getByText("security page body")).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });
  });

  it("a non-admin still cannot reach a lookalike path", () => {
    auth = { user: { role: "viewer" }, loading: false };
    pathname = "/settings/security/extra";
    render(
      <SettingsLayout>
        <div>nope</div>
      </SettingsLayout>,
    );
    expect(screen.queryByText("nope")).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("renders nothing while the session is still loading", () => {
    auth = { user: null, loading: true };
    render(<SettingsLayout><SettingsIndexPage /></SettingsLayout>);
    expect(screen.queryByLabelText("Search settings")).not.toBeInTheDocument();
    expect(getShop).not.toHaveBeenCalled();
  });

  it.each(NEW_ROUTES)("an admin gets %s", (route, page, marker) => {
    auth = { user: { role: "admin" }, loading: false };
    pathname = route;
    render(<SettingsLayout>{page()}</SettingsLayout>);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    // Pages that load first show their content asynchronously; the landing
    // page and the pointer card are synchronous.
    if (route === "/settings" || route === "/settings/jobs") expect(has(marker)).toBe(true);
  });

  it("shows the grouped sidebar on a settings page but not on the landing page or the outlet editor", () => {
    auth = { user: { role: "admin" }, loading: false };
    pathname = "/settings/selling/money-tax";
    const { unmount } = render(<SettingsLayout><div /></SettingsLayout>);
    expect(screen.getByRole("navigation", { name: "Settings" })).toBeInTheDocument();
    unmount();

    for (const p of ["/settings", "/settings/outlets/3/edit"]) {
      pathname = p;
      const r = render(<SettingsLayout><div /></SettingsLayout>);
      expect(screen.queryByRole("navigation", { name: "Settings" })).not.toBeInTheDocument();
      r.unmount();
    }
  });
});
