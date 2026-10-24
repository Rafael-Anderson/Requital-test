import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChannelOrder } from "@/lib/types";

const api = vi.hoisted(() => ({
  getChannelAvailability: vi.fn(),
  listChannelOrders: vi.fn(),
  acceptChannelOrder: vi.fn(),
  rejectChannelOrder: vi.fn(),
  listChannelProviders: vi.fn(),
  markChannelOrderReady: vi.fn(),
  confirmScheduledChannelOrder: vi.fn(),
}));
vi.mock("@/lib/api", () => api);
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
let role = "admin";
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: 1, role, name: "Ada", email: "a@b.c", outletId: null }, loading: false }),
}));
vi.mock("@/lib/outlet-context", () => ({
  useOutletFilter: () => ({ selectedOutletId: null, outlets: [{ id: 5, name: "Marina Branch" }], setSelectedOutletId: () => {} }),
}));
vi.mock("@/components/OutletSwitcher", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/orders/marketplace" }));

import Page from "./page";
import { resetChannelAvailabilityCache } from "@/lib/useChannelAvailability";

const order = (over: Partial<ChannelOrder> = {}): ChannelOrder => ({
  id: 1,
  outletId: 5,
  provider: "deliveroo",
  externalOrderId: "ext-1",
  displayId: "A100",
  state: "pending_acceptance",
  externalStatus: "placed",
  acceptBy: new Date(Date.now() + 5 * 60_000).toISOString(),
  scheduledFor: null,
  confirmBy: null,
  confirmedAt: null,
  readyAt: null,
  orderId: 77,
  shopOrderNumber: 12,
  orderStatus: "pending",
  currency: "AED",
  total: "84.50",
  commissionAmount: null,
  priceMismatch: null,
  waitingItems: null,
  lastError: null,
  alerted: true,
  receivedAt: new Date().toISOString(),
  ...over,
});

const list = (data: ChannelOrder[]) => ({ data, page: 1, pageSize: 100, total: data.length });

beforeEach(() => {
  vi.clearAllMocks();
  resetChannelAvailabilityCache();
  role = "admin";
  api.getChannelAvailability.mockResolvedValue({ enabled: true, hasConnections: true });
  api.listChannelProviders.mockResolvedValue([
    {
      name: "deliveroo",
      displayName: "Deliveroo",
      credentialFields: [],
      capabilities: { acceptReject: true, platformWebhookSecret: false, provesLocationOwnership: false, markReady: true, scheduledConfirm: true },
    },
  ]);
});
afterEach(cleanup);

describe("Marketplace orders desk", () => {
  it("a shop without the feature or any connection sees a calm state and makes no order request", async () => {
    api.getChannelAvailability.mockResolvedValue({ enabled: false, hasConnections: false });
    render(<Page />);
    expect(await screen.findByText(/Marketplace orders are not available for your shop yet/)).toBeInTheDocument();
    expect(api.listChannelOrders).not.toHaveBeenCalled();
  });

  it("an availability failure ends in an error with Try again", async () => {
    api.getChannelAvailability.mockRejectedValueOnce(new Error("boom"));
    api.getChannelAvailability.mockResolvedValue({ enabled: false, hasConnections: false });
    render(<Page />);
    expect(await screen.findByText(/Could not load marketplace orders/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/not available for your shop yet/)).toBeInTheDocument();
  });

  it("a failed list ends in an error with Try again, and Try again asks again", async () => {
    api.listChannelOrders.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(list([]));
    render(<Page />);
    expect(await screen.findByText(/Could not load marketplace orders/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No marketplace orders yet")).toBeInTheDocument();
  });

  it("a pending order is prominent: source, deadline countdown, status in words, Accept and Reject, no raw enum", async () => {
    api.listChannelOrders.mockResolvedValue(list([order()]));
    render(<Page />);
    const card = await screen.findByRole("article", { name: "deliveroo order A100" });
    expect(within(card).getByText("Deliveroo")).toBeInTheDocument();
    expect(within(card).getByText("Waiting for you to accept")).toBeInTheDocument();
    expect(within(card).getByRole("timer")).toHaveTextContent(/Accept within [0-5] min/);
    expect(within(card).getByRole("button", { name: "Accept order" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(within(card).getByText("Marina Branch")).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/pending_acceptance|needs_mapping|cancelled_upstream/);
    expect(screen.getByRole("heading", { name: /Waiting for you \(1\)/ })).toBeInTheDocument();
  });

  it("a pending order without a deadline says so and invents none", async () => {
    api.listChannelOrders.mockResolvedValue(list([order({ acceptBy: null })]));
    render(<Page />);
    expect(await screen.findByText(/No deadline from the marketplace/)).toBeInTheDocument();
  });

  it("an expired window is stated, not hidden", async () => {
    api.listChannelOrders.mockResolvedValue(list([order({ acceptBy: new Date(Date.now() - 60_000).toISOString() })]));
    render(<Page />);
    expect(await screen.findByText(/acceptance window has passed/i)).toBeInTheDocument();
  });

  it("Accept calls the desk endpoint and refreshes; a provider failure shows the API's words and changes nothing", async () => {
    const user = userEvent.setup();
    api.listChannelOrders.mockResolvedValue(list([order()]));
    api.acceptChannelOrder.mockRejectedValueOnce(new Error("The marketplace did not accept the accept. Nothing was changed; try again."));
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: "Accept order" }));
    expect(await screen.findByText(/Nothing was changed; try again/)).toBeInTheDocument();
    expect(api.acceptChannelOrder).toHaveBeenCalledWith(1);
    api.acceptChannelOrder.mockResolvedValueOnce(order({ state: "accepted" }));
    api.listChannelOrders.mockResolvedValue(list([order({ state: "accepted" })]));
    await user.click(screen.getByRole("button", { name: "Accept order" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Order accepted"));
    expect(await screen.findByText("Accepted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept order" })).not.toBeInTheDocument();
  });

  it("Reject asks first, sends the optional reason, and never rejects on the first click", async () => {
    const user = userEvent.setup();
    api.listChannelOrders.mockResolvedValue(list([order()]));
    api.rejectChannelOrder.mockResolvedValue(order({ state: "rejected" }));
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: "Reject" }));
    expect(api.rejectChannelOrder).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason (optional)"), "item sold out");
    await user.click(within(dialog).getByRole("button", { name: "Reject order" }));
    await waitFor(() => expect(api.rejectChannelOrder).toHaveBeenCalledWith(1, "item sold out"));
  });

  it("needs-mapping orders stay visible with their items, the explanation and a link for admins", async () => {
    api.listChannelOrders.mockResolvedValue(
      list([order({ id: 2, state: "needs_mapping", orderId: null, shopOrderNumber: null, total: "30.00", waitingItems: [{ externalItemId: "p1", name: "Rose Bouquet", quantity: 2 }] })]),
    );
    render(<Page />);
    expect(await screen.findByText("Needs item mapping", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("2 x Rose Bouquet")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is created for you/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Link these items" })).toHaveAttribute("href", "/settings/integrations/sales-channels#unmapped");
    expect(screen.queryByRole("button", { name: "Accept order" })).not.toBeInTheDocument();
  });

  it("non-admins get no link into settings", async () => {
    role = "order_manager";
    api.listChannelOrders.mockResolvedValue(list([order({ id: 2, state: "needs_mapping", orderId: null, waitingItems: [] })]));
    render(<Page />);
    await screen.findByText("Needs item mapping", { selector: "span" });
    expect(screen.queryByRole("link", { name: "Link these items" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Settings, Sales channels/)).not.toBeInTheDocument();
  });

  it("states are shown in words: accepted, rejected, cancelled by the marketplace", async () => {
    api.listChannelOrders.mockResolvedValue(
      list([order({ id: 3, state: "accepted", displayId: "B1" }), order({ id: 4, state: "rejected", displayId: "B2" }), order({ id: 5, state: "cancelled_upstream", displayId: "B3" })]),
    );
    render(<Page />);
    expect(await screen.findByText("Cancelled by the marketplace", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Accepted", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Rejected", { selector: "span" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/cancelled_upstream/);
  });

  it("commission shows only when the API sent it (admins), with the order's own currency", async () => {
    api.listChannelOrders.mockResolvedValue(list([order({ currency: "KWD", total: "12.505", commissionAmount: "1.876" })]));
    render(<Page />);
    expect(await screen.findByText(/Marketplace commission KWD 1\.876|Marketplace commission 1\.876 KWD/)).toBeInTheDocument();
    cleanup();
    api.listChannelOrders.mockResolvedValue(list([order({ commissionAmount: null })]));
    render(<Page />);
    await screen.findByRole("article", { name: "deliveroo order A100" });
    expect(screen.queryByText(/Marketplace commission/)).not.toBeInTheDocument();
  });

  it("a price difference is explained and the marketplace price is kept", async () => {
    api.listChannelOrders.mockResolvedValue(list([order({ priceMismatch: [{ payloadMinor: 4000, catalogMinor: 3500 }] })]));
    render(<Page />);
    expect(await screen.findByText(/marketplace price differs from your catalogue price on 1 line/)).toBeInTheDocument();
  });

  it("links to the real order and mentions the queued alert", async () => {
    api.listChannelOrders.mockResolvedValue(list([order()]));
    render(<Page />);
    expect(await screen.findByRole("link", { name: "View order #12" })).toHaveAttribute("href", "/orders?orderId=77");
    expect(screen.getByText(/WhatsApp alert queued for the outlet/)).toBeInTheDocument();
  });

  describe("ready for collection and the scheduled confirm step", () => {
    const accepted = (over: Partial<ChannelOrder> = {}) =>
      order({ state: "accepted", ...over });
    const scheduled = (over: Partial<ChannelOrder> = {}) =>
      accepted({
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
        confirmBy: new Date(Date.now() + 3_600_000).toISOString(),
        ...over,
      });

    it("an accepted scheduled order offers Confirm scheduled order; it asks first and only the dialog calls the API", async () => {
      const user = userEvent.setup();
      api.listChannelOrders.mockResolvedValue(list([scheduled()]));
      api.confirmScheduledChannelOrder.mockResolvedValue(scheduled({ confirmedAt: new Date().toISOString() }));
      render(<Page />);
      const card = await screen.findByRole("article", { name: "deliveroo order A100" });
      expect(within(card).getByText(/Confirm it by/)).toBeInTheDocument();
      await user.click(await within(card).findByRole("button", { name: "Confirm scheduled order" }));
      expect(api.confirmScheduledChannelOrder).not.toHaveBeenCalled();
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Not yet" }));
      expect(api.confirmScheduledChannelOrder).not.toHaveBeenCalled();
      await user.click(await screen.findByRole("button", { name: "Confirm scheduled order" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm order" }));
      await waitFor(() => expect(api.confirmScheduledChannelOrder).toHaveBeenCalledWith(1));
      await waitFor(() => expect(toast).toHaveBeenCalledWith("Scheduled order confirmed"));
    });

    it("Ready for collection asks first, warns it cannot be undone, then calls", async () => {
      const user = userEvent.setup();
      api.listChannelOrders.mockResolvedValue(list([accepted()]));
      api.markChannelOrderReady.mockResolvedValue(accepted({ readyAt: new Date().toISOString() }));
      render(<Page />);
      await user.click(await screen.findByRole("button", { name: "Ready for collection" }));
      expect(api.markChannelOrderReady).not.toHaveBeenCalled();
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Mark ready" }));
      await waitFor(() => expect(api.markChannelOrderReady).toHaveBeenCalledWith(1));
    });

    it("a marketplace refusal shows the API's words in the dialog and keeps it open", async () => {
      const user = userEvent.setup();
      api.listChannelOrders.mockResolvedValue(list([accepted()]));
      api.markChannelOrderReady.mockRejectedValue(new Error("The marketplace did not accept the mark it ready. Nothing was changed; try again."));
      render(<Page />);
      await user.click(await screen.findByRole("button", { name: "Ready for collection" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Mark ready" }));
      expect(await within(screen.getByRole("dialog")).findByText(/Nothing was changed/)).toBeInTheDocument();
    });

    it("no button for a plain order, a confirmed or ready one, a pending one, or a provider without the capability", async () => {
      api.listChannelOrders.mockResolvedValue(
        list([
          accepted({ id: 1, displayId: "P1" }),
          scheduled({ id: 2, displayId: "S1", confirmedAt: new Date().toISOString(), readyAt: new Date().toISOString() }),
          order({ id: 3, displayId: "W1" }),
        ]),
      );
      api.listChannelProviders.mockResolvedValue([
        { name: "deliveroo", displayName: "Deliveroo", credentialFields: [], capabilities: { acceptReject: true, platformWebhookSecret: false, provesLocationOwnership: false, markReady: false, scheduledConfirm: false } },
      ]);
      render(<Page />);
      await screen.findByRole("article", { name: "deliveroo order P1" });
      expect(screen.queryByRole("button", { name: "Ready for collection" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Confirm scheduled order" })).not.toBeInTheDocument();
      expect(screen.getByText(/Marked ready for collection/)).toBeInTheDocument();
      expect(screen.getByText(/Confirmed/, { selector: "span" })).toBeInTheDocument();
    });

    it("if the capabilities cannot be loaded the desk still works and simply offers no extra buttons", async () => {
      api.listChannelProviders.mockRejectedValue(new Error("no"));
      api.listChannelOrders.mockResolvedValue(list([scheduled(), order({ id: 9, displayId: "W9" })]));
      render(<Page />);
      expect(await screen.findByRole("button", { name: "Accept order" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Confirm scheduled order" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Ready for collection" })).not.toBeInTheDocument();
    });

    it("non-admin desk roles get the same buttons", async () => {
      role = "order_manager";
      api.listChannelOrders.mockResolvedValue(list([accepted()]));
      render(<Page />);
      expect(await screen.findByRole("button", { name: "Ready for collection" })).toBeInTheDocument();
    });
  });
});
