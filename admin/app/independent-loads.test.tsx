import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";

// Pages that used to gate on Promise.all (or on one shared request): one request rejects or never
// answers, the other answers, and the section the other feeds must still render. A page that
// waits for every request before showing anything fails these.
const impl = vi.hoisted(() => ({ map: {} as Record<string, () => Promise<unknown>> }));
const never = () => new Promise<never>(() => {});
const reject = () => Promise.reject(new Error("boom"));
const ok = (v: unknown) => () => Promise.resolve(v);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const [name, fn] of Object.entries(actual)) {
    if (typeof fn === "function" && /^(list|get)[A-Z]/.test(name) && name !== "getStaffCsrfToken") {
      wrapped[name] = vi.fn(() => (impl.map[name] ?? never)());
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
  useParams: () => ({ id: "1", outletId: "1" }),
}));

import { ToastProvider } from "@/components/ui/Toast";

beforeEach(() => {
  impl.map = {};
});
afterEach(cleanup);

const mount = (el: ReactElement) => render(<ToastProvider>{el}</ToastProvider>);

describe("independent loads", () => {
  it("discounts: the table shows when the product and collection lists fail or never answer", async () => {
    impl.map = {
      listDiscounts: ok([
        { id: 1, code: "SAVE10", discountType: "code", type: "PERCENTAGE", value: "10", minPurchaseAmount: null, appliesTo: "ALL_PRODUCTS", products: [], collections: [], usageLimit: null, usageLimitPerCustomer: null, startsAt: null, endsAt: null, active: true, timesUsed: 0, createdAt: "", updatedAt: "" },
      ]),
      listProducts: reject,
      listCollections: never,
    };
    const { default: Page } = await import("./products/discounts/page");
    mount(<Page />);
    expect((await screen.findAllByText("SAVE10")).length).toBeGreaterThan(0);
  });

  it("affiliates: the list shows when the summary fails, and the summary shows while the list is pending", async () => {
    impl.map = {
      getAffiliateSummary: reject,
      listAffiliates: ok({ data: [{ id: 1, name: "Reem Al Suwaidi", mobile: "0505550001", status: "active", createdAt: "2026-01-01", codesCount: 1, ordersCount: 0 }], total: 1 }),
    };
    const { default: Page } = await import("./affiliate/page");
    mount(<Page />);
    expect((await screen.findAllByText("Reem Al Suwaidi")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Could not load the summary.")).toBeTruthy();
  });

  it("settings users: staff show while roles fail and outlets never answer", async () => {
    impl.map = {
      listShopUsers: ok([{ id: 7, shopId: 1, outletId: null, name: "Noor Viewer", email: "n@x.co", role: "viewer", emailVerified: true, createdAt: "" }]),
      listOutlets: never,
      listBranchRoles: reject,
      listBranchRoleAssignments: never,
    };
    const { default: Page } = await import("./settings/users/page");
    mount(<Page />);
    expect((await screen.findAllByText("Noor Viewer")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Could not load branch roles.")).toBeTruthy();
  });

  it("messaging: the number card shows when the credentials request fails", async () => {
    impl.map = {
      getShop: ok({ whatsappCountryCode: "+971", whatsappNumber: "", notifyCustomersWhatsapp: false, whatsappFloatingButtonEnabled: false }),
      getWhatsAppSettings: reject,
    };
    const { default: Page } = await import("./integrations/messaging/page");
    mount(<Page />);
    expect(await screen.findByText("Could not load WhatsApp credentials.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "WhatsApp" })).toBeTruthy();
  });

  it("margin report: the breakdown shows while the summary never answers", async () => {
    impl.map = { getMarginSummary: never, getMarginBreakdown: ok([]) };
    const { default: Page } = await import("./reports/margin/page");
    mount(<Page />);
    expect(await screen.findByText("Nothing in this range")).toBeTruthy();
  });

  it.each([
    ["general", () => import("./reports/page"), "getGeneralReportSummary", "listGeneralReportOrders"],
    ["monthly", () => import("./reports/monthly/page"), "getMonthlyReportSummary", "listMonthlyReportOrders"],
  ])("%s report: the order list shows when the summary fails", async (_n, load, summaryFn, listFn) => {
    impl.map = { [summaryFn]: reject, [listFn]: ok({ data: [], total: 0, page: 1, pageSize: 20 }) };
    const { default: Page } = await load();
    mount(<Page />);
    expect(await screen.findByText("No orders yet")).toBeTruthy();
    expect(await screen.findByText("Could not load the summary.")).toBeTruthy();
  });

  it("dashboard: top products show when daily revenue fails", async () => {
    impl.map = { getDashboardSummary: never, getDailyRevenue: reject, getTopProducts: ok([]) };
    const { default: Page } = await import("./dashboard/page");
    mount(<Page />);
    expect(await screen.findByText("Could not load revenue.")).toBeTruthy();
    expect(await screen.findByText("No sales in this range.")).toBeTruthy();
  });

  it("simple dashboard: revenue and orders show when the top product request fails", async () => {
    impl.map = { getDashboardSummary: ok({ revenue: { current: 5 }, totalOrders: 2 }), getTopProducts: reject };
    const { default: M } = await import("@/components/SimpleDashboard");
    mount(<M />);
    expect(await screen.findByText("Orders Today")).toBeTruthy();
    expect(await screen.findByText("Could not load the top product.")).toBeTruthy();
  });

  it("theme site settings: a failed theme shows its error while the shop is still loading", async () => {
    impl.map = { getShop: never, getTheme: reject };
    const { default: Page } = await import("./theme/edit/site-settings/page");
    mount(<Page />);
    expect(await screen.findByText("Could not load the theme.")).toBeTruthy();
  });

  it("outlet delivery areas: the zones show when the mapping proposal fails", async () => {
    impl.map = { listDeliveryZones: ok([]), getZoneMappingProposal: reject, getRegions: never };
    const { default: M } = await import("@/components/OutletDeliveryAreaTab");
    mount(<M outletId={1} />);
    expect(await screen.findByText("No delivery zones yet")).toBeTruthy();
  });

  it("purchase order line picker: ingredients stay pickable when the product list fails", async () => {
    impl.map = { listIngredients: ok([{ id: 3, name: "Red roses", unit: "stem" }]), listProducts: reject };
    const { usePurchasePickerOptions } = await import("@/components/PurchaseOrderLinesEditor");
    const { result } = renderHook(() => usePurchasePickerOptions());
    await waitFor(() => expect(result.current).toEqual([{ value: "i:3", label: "Red roses (stem)" }]));
  });
});
