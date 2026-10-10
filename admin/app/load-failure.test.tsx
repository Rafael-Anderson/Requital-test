import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

// Every admin page and panel that loads data on mount, with EVERY read request rejecting (the
// worst case for a page that gates on one request): it must leave the skeleton and show an
// error with Try again, and Try again must ask again. A page that only renders `data === null ?
// skeleton` stays on the skeleton and fails here.
const calls = vi.hoisted(() => ({ reads: new Map<string, number>() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const [name, fn] of Object.entries(actual)) {
    // reads only; pure helpers (getStaffCsrfToken) and writes stay real
    if (typeof fn === "function" && /^(list|get)[A-Z]/.test(name) && name !== "getStaffCsrfToken") {
      wrapped[name] = vi.fn(() => {
        calls.reads.set(name, (calls.reads.get(name) ?? 0) + 1);
        return Promise.reject(new Error("boom"));
      });
    }
  }
  return wrapped;
});
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin", name: "Ada", email: "a@b.c", outletId: null }, loading: false }),
}));
vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({ selectedOutletId: null, outlets: [], setSelectedOutletId: () => {} }),
}));
vi.mock("@/components/OutletSwitcher", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "1", outletId: "1", themeId: "1" }),
}));

import { ToastProvider } from "@/components/ui/Toast";

type Entry = [name: string, load: () => Promise<ReactElement>];
const page = (name: string, load: () => Promise<{ default: React.ComponentType }>): Entry => [
  name,
  async () => {
    const Page = (await load()).default;
    return <Page />;
  },
];

const ENTRIES: Entry[] = [
  page("activity log", () => import("./activity-log/page")),
  page("affiliates", () => import("./affiliate/page")),
  page("affiliate codes", () => import("./affiliate/codes/page")),
  page("affiliate orders", () => import("./affiliate/orders/page")),
  page("bio links", () => import("./bio-links/page")),
  page("customer detail", () => import("./customers/[id]/page")),
  page("newsletter", () => import("./customers/newsletter/page")),
  page("reviews", () => import("./customers/reviews/page")),
  page("dashboard", () => import("./dashboard/page")),
  page("integrations: delivery", () => import("./integrations/page")),
  page("integrations: analytics", () => import("./integrations/analytics/page")),
  page("integrations: messaging", () => import("./integrations/messaging/page")),
  page("integrations: payments", () => import("./integrations/payments/page")),
  page("ingredients", () => import("./inventory/page")),
  page("ingredient categories", () => import("./inventory/categories/page")),
  page("movements", () => import("./inventory/movements/page")),
  page("purchase orders", () => import("./inventory/purchase-orders/page")),
  page("purchase order detail", () => import("./inventory/purchase-orders/[id]/page")),
  page("suppliers", () => import("./inventory/suppliers/page")),
  page("supplier detail", () => import("./inventory/suppliers/[id]/page")),
  page("order detail", () => import("./orders/[id]/page")),
  page("orders kanban", () => import("./orders/page")),
  page("abandoned carts", () => import("./orders/abandoned-carts/page")),
  page("branch status", () => import("./orders/branch-status/page")),
  page("external deliveries", () => import("./orders/external-delivery/page")),
  page("delivery runs", () => import("./orders/runs/page")),
  page("delivery run detail", () => import("./orders/runs/[id]/page")),
  page("drivers", () => import("./orders/drivers/page")),
  page("edit product", () => import("./products/[id]/edit/page")),
  page("brands", () => import("./products/brands/page")),
  page("collections", () => import("./products/categories/page")),
  page("discounts", () => import("./products/discounts/page")),
  page("gift cards", () => import("./products/gift-cards/page")),
  page("templates", () => import("./products/templates/page")),
  page("edit template", () => import("./products/templates/[id]/edit/page")),
  page("report: general", () => import("./reports/page")),
  page("report: monthly", () => import("./reports/monthly/page")),
  page("report: product sales", () => import("./reports/product-sales/page")),
  page("report: inventory", () => import("./reports/inventory/page")),
  page("report: margin", () => import("./reports/margin/page")),
  page("report: prep time", () => import("./reports/prep-time/page")),
  page("report: attribution", () => import("./reports/attribution/page")),
  page("report: external delivery", () => import("./reports/external-delivery/page")),
  page("settings: custom fields", () => import("./settings/business/custom-fields/page")),
  page("settings: domain", () => import("./settings/business/domain/page")),
  page("settings: information", () => import("./settings/business/information/page")),
  page("settings: online presence", () => import("./settings/business/online-presence/page")),
  page("settings: policy pages", () => import("./settings/business/policy-pages/page")),
  page("settings: SEO", () => import("./settings/business/seo/page")),
  page("settings: store configuration", () => import("./settings/business/store-configuration/page")),
  page("settings: tax classes", () => import("./settings/business/tax-classes/page")),
  page("settings: diagnostics", () => import("./settings/diagnostics/page")),
  page("settings: delivery", () => import("./settings/fulfilment/delivery/page")),
  page("settings: pickup", () => import("./settings/fulfilment/pickup/page")),
  page("settings: outlets", () => import("./settings/outlets/page")),
  page("settings: edit outlet", () => import("./settings/outlets/[outletId]/edit/page")),
  page("settings: money and tax", () => import("./settings/selling/money-tax/page")),
  page("settings: display", () => import("./settings/storefront/display/page")),
  page("settings: redirects", () => import("./settings/storefront/redirects/page")),
  page("settings: security", () => import("./settings/security/page")),
  page("settings: users", () => import("./settings/users/page")),
  page("theme", () => import("./theme/page")),
  page("theme: layout", () => import("./theme/edit/advanced/page")),
  page("theme: colors", () => import("./theme/edit/appearance-color/page")),
  page("theme: site settings", () => import("./theme/edit/site-settings/page")),
  [
    "order detail modal",
    async () => {
      const { default: M } = await import("@/components/OrderDetailModal");
      return <M orderId={1} onClose={() => {}} onChanged={() => {}} />;
    },
  ],
  [
    "simple order detail modal",
    async () => {
      const { default: M } = await import("@/components/SimpleOrderDetailModal");
      return <M orderId={1} onClose={() => {}} onChanged={() => {}} />;
    },
  ],
  [
    "simple dashboard",
    async () => {
      const { default: M } = await import("@/components/SimpleDashboard");
      return <M />;
    },
  ],
  [
    "today card",
    async () => {
      const { default: M } = await import("@/components/TodayCard");
      return <M />;
    },
  ],
  [
    "outlet QR code",
    async () => {
      const { default: M } = await import("@/components/OutletQrTab");
      return <M outlet={{ id: 1, name: "Main" } as never} />;
    },
  ],
  [
    "outlet delivery areas",
    async () => {
      const { default: M } = await import("@/components/OutletDeliveryAreaTab");
      return <M outletId={1} />;
    },
  ],
];

beforeEach(() => calls.reads.clear());
afterEach(cleanup);

const total = () => [...calls.reads.values()].reduce((a, b) => a + b, 0);
const busy = () => document.querySelectorAll(".animate-pulse, [aria-busy='true']").length;

describe("every loading page ends in an error with Try again when its requests fail", () => {
  it.each(ENTRIES)("%s", async (_name, load) => {
    render(<ToastProvider>{await load()}</ToastProvider>);
    const failed = await screen.findAllByText(/Could not load/i, {}, { timeout: 4000 });
    expect(failed.length).toBeGreaterThan(0);
    // no skeleton left on screen
    await waitFor(() => expect(busy()).toBe(0));
    // Try again asks again
    const before = total();
    await userEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    await waitFor(() => expect(total()).toBeGreaterThan(before));
  }, 15000);
});
