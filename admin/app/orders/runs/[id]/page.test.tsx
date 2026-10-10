import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DeliveryRunDetail } from "@/lib/types";

const api = vi.hoisted(() => ({
  getDeliveryRun: vi.fn(),
  dispatchDeliveryRun: vi.fn(),
  reorderRunStops: vi.fn(),
  removeRunStop: vi.fn(),
  cancelDeliveryRun: vi.fn(),
  issueRunLink: vi.fn(),
  revokeRunLink: vi.fn(),
  sendRunLinkWhatsApp: vi.fn(),
  getRunSheetHtml: vi.fn(),
  resolveImageUrl: (u: string | null) => u,
}));
vi.mock("@/lib/api", () => api);
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "7" }) }));

import { ToastProvider } from "@/components/ui/Toast";
import Page from "./page";

const stop = (id: number, position: number, extra: Partial<DeliveryRunDetail["stops"][number]> = {}) => ({
  id,
  position,
  status: "pending" as const,
  failureReason: null,
  deliveredAt: null,
  failedAt: null,
  proofType: null,
  proofPhotoUrl: null,
  cod: false,
  codExpected: null,
  cashCollectedAmount: null,
  cashCurrency: null,
  cashDiscrepancy: false,
  order: {
    id: id * 10,
    shopOrderNumber: id,
    customerName: `Customer ${id}`,
    customerPhone: "050",
    customerAddress: "Somewhere",
    area: null,
    regionName: null,
    deliveryNotes: null,
    deliveryTimeSlot: null,
    status: "out_for_delivery",
    paymentMethod: null,
    total: "100",
    currency: "AED",
  },
  ...extra,
});

const run = (extra: Partial<DeliveryRunDetail> = {}): DeliveryRunDetail => ({
  id: 7,
  outletId: 1,
  status: "draft",
  runDate: null,
  notes: null,
  proofRequirement: "photo_or_otp",
  driver: { id: 1, name: "Omar", phone: "050", active: true },
  stops: [stop(1, 1), stop(2, 2)],
  link: null,
  cash: [],
  ...extra,
});

const renderPage = () =>
  render(
    <ToastProvider>
      <Page />
    </ToastProvider>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("delivery run detail", () => {
  it("dispatches and shows the one-time link; a draft has no link card", async () => {
    api.getDeliveryRun.mockResolvedValue(run());
    api.dispatchDeliveryRun.mockResolvedValue(
      run({ status: "dispatched", issuedLink: { url: "https://admin.example/driver/abc", expiresAt: "2026-10-10T20:00:00Z" } }),
    );
    renderPage();
    await screen.findByText("Run #7");
    expect(screen.queryByText("Driver link")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Dispatch" }));
    const input = await screen.findByLabelText("Driver link");
    expect((input as HTMLInputElement).value).toBe("https://admin.example/driver/abc");
    expect(screen.getByText(/will not be shown again/)).toBeTruthy();
  });

  it("reorders by sending every stop id in the new order", async () => {
    api.getDeliveryRun.mockResolvedValue(run());
    api.reorderRunStops.mockResolvedValue(run({ stops: [stop(2, 1), stop(1, 2)] }));
    renderPage();
    await screen.findByText("Run #7");
    await userEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    await waitFor(() => expect(api.reorderRunStops).toHaveBeenCalledWith(7, [2, 1]));
  });

  it("flags a cash mismatch for staff and never shows a link it cannot know", async () => {
    api.getDeliveryRun.mockResolvedValue(
      run({
        status: "in_progress",
        link: { expiresAt: "2026-10-10T20:00:00Z", lastUsedAt: null },
        stops: [
          stop(1, 1, { status: "delivered", cod: true, codExpected: "100.00", cashCollectedAmount: "90.00", cashCurrency: "AED", cashDiscrepancy: true }),
        ],
        cash: [{ currency: "AED", expected: "100.00", collected: "90.00", difference: "-10.00", pending: "0.00", discrepancies: 1 }],
      }),
    );
    renderPage();
    await screen.findByText(/does not match/);
    expect(screen.getByText(/1 mismatch/)).toBeTruthy();
    expect(screen.queryByLabelText("Driver link")).toBeNull();
    expect(screen.getByText(/cannot be shown again/)).toBeTruthy();
  });
});
