import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import OutletBasicInfoTab from "./OutletBasicInfoTab";
import { ToastProvider } from "@/components/ui/Toast";
import type { Outlet, Shop } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({ getShop: vi.fn(), updateOutlet: vi.fn(), updateShop: vi.fn() }));
import { getShop, updateShop } from "@/lib/api";

const shop = {
  country: "United Arab Emirates",
  timezone: "Asia/Dubai",
  currency: "AED",
  defaultLanguage: "en",
  allowSameDayOrders: true,
  allowNextDayOrders: false,
  taxRate: "5.00",
  taxInclusive: false,
  taxOnDelivery: true,
} as unknown as Shop;

const outlet = { id: 1, name: "Main", businessHours: null, closedOverride: false } as unknown as Outlet;

// "Order Setting" (same-day, next-day, tax rate, tax type, tax on delivery) was
// the only route to the VAT rate. It is now a read-only summary linking to the
// pages that own those fields.
describe("OutletBasicInfoTab order and tax summary", () => {
  it("shows the shop-wide values and links to Money & Tax and Delivery", async () => {
    vi.mocked(getShop).mockResolvedValue(shop);
    render(
      <ToastProvider>
        <OutletBasicInfoTab outlet={outlet} onSaved={vi.fn()} />
      </ToastProvider>,
    );
    await screen.findByText("Order and Tax Settings");
    expect(screen.getByText("5%")).toBeInTheDocument();
    expect(screen.getByText("Exclusive")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Change tax for all outlets/ })).toHaveAttribute(
      "href",
      "/settings/selling/money-tax",
    );
    expect(screen.getByRole("link", { name: /Change order dates for all outlets/ })).toHaveAttribute(
      "href",
      "/settings/fulfilment/delivery",
    );
  });

  it("has no tax or order-date inputs and never calls updateShop", async () => {
    vi.mocked(getShop).mockResolvedValue(shop);
    render(
      <ToastProvider>
        <OutletBasicInfoTab outlet={outlet} onSaved={vi.fn()} />
      </ToastProvider>,
    );
    await screen.findByText("Order and Tax Settings");
    expect(screen.queryByLabelText("Tax Rate (%)")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /orders/ })).not.toBeInTheDocument();
    expect(updateShop).not.toHaveBeenCalled();
  });
});
