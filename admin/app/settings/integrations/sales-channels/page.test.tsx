import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChannelConnection, ChannelProviderInfo, ChannelUnmappedItem, Outlet, Product } from "@/lib/types";

const api = vi.hoisted(() => ({
  getChannelAvailability: vi.fn(),
  listChannelConnections: vi.fn(),
  listChannelProviders: vi.fn(),
  listChannelUnmappedItems: vi.fn(),
  listOutlets: vi.fn(),
  listProducts: vi.fn(),
  createChannelConnection: vi.fn(),
  updateChannelConnection: vi.fn(),
  setChannelConnectionEnabled: vi.fn(),
  testChannelConnection: vi.fn(),
  deleteChannelConnection: vi.fn(),
  resolveChannelUnmappedItem: vi.fn(),
}));
vi.mock("@/lib/api", () => api);
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));

import Page from "./page";

const provider: ChannelProviderInfo = {
  name: "deliveroo",
  displayName: "Deliveroo",
  credentialFields: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client secret" },
  ],
  capabilities: { acceptReject: true, platformWebhookSecret: false, provesLocationOwnership: false },
};
const outlet = { id: 5, name: "Marina Branch", whatsapp: "+971500000001", phone: null } as unknown as Outlet;
const outlet2 = { id: 6, name: "Mall Branch", whatsapp: null, phone: null } as unknown as Outlet;

const conn = (over: Partial<ChannelConnection> = {}): ChannelConnection => ({
  id: 1,
  outletId: 5,
  provider: "deliveroo",
  externalLocationId: "LOC-123",
  externalBrandId: null,
  externalSiteId: null,
  hasCredentials: true,
  hasWebhookSecret: true,
  enabled: false,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastError: null,
  locationVerified: false,
  createdAt: "2026-10-13T00:00:00.000Z",
  ...over,
});

const SECRET_VALUE = "super-secret-value-123";

function setup(opts: {
  flag?: boolean;
  has?: boolean;
  connections?: ChannelConnection[];
  unmapped?: ChannelUnmappedItem[];
}) {
  api.getChannelAvailability.mockResolvedValue({ enabled: opts.flag ?? true, hasConnections: opts.has ?? (opts.connections?.length ?? 0) > 0 });
  api.listChannelConnections.mockResolvedValue(opts.connections ?? []);
  api.listChannelProviders.mockResolvedValue([provider]);
  api.listOutlets.mockResolvedValue([outlet, outlet2]);
  api.listChannelUnmappedItems.mockResolvedValue(opts.unmapped ?? []);
  api.listProducts.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Sales channels settings page", () => {
  it("flag off and no connections: a calm not-available state and no request beyond the flag check", async () => {
    setup({ flag: false, has: false });
    render(<Page />);
    expect(await screen.findByText(/not available for your shop yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add connection/i })).not.toBeInTheDocument();
    expect(api.getChannelAvailability).toHaveBeenCalledTimes(1);
    for (const name of ["listChannelConnections", "listChannelProviders", "listOutlets", "listChannelUnmappedItems", "listProducts"] as const) {
      expect(api[name], name).not.toHaveBeenCalled();
    }
  });

  it("a failed availability check ends in an error with Try again", async () => {
    api.getChannelAvailability.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ enabled: false, hasConnections: false });
    render(<Page />);
    expect(await screen.findByText(/Could not load sales channels/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/not available for your shop yet/i)).toBeInTheDocument();
  });

  it("no connections: guidance and an Add connection button", async () => {
    setup({ connections: [] });
    render(<Page />);
    expect(await screen.findByText("No sales channels connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add connection/i })).toBeEnabled();
    expect(await screen.findByText("Nothing is waiting to be linked")).toBeInTheDocument();
  });

  it("unverified connection: waiting-for-Requital explanation, a disabled switch with its reason, off by default", async () => {
    setup({ connections: [conn()] });
    render(<Page />);
    const card = await screen.findByRole("article", { name: "Deliveroo at Marina Branch" });
    expect(within(card).getByText("Waiting for Requital to verify your location.")).toBeInTheDocument();
    expect(within(card).getByText("Waiting for verification")).toBeInTheDocument();
    const sw = within(card).getByRole("switch", { name: "Receive Deliveroo orders at Marina Branch" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toBeDisabled();
    expect(within(card).getByText("Waiting for Requital to verify your location with the marketplace.")).toBeInTheDocument();
    expect(sw).toHaveAttribute("aria-describedby");
    // credentials are only ever shown as set, never as a value
    expect(within(card).getByText("Saved, hidden")).toBeInTheDocument();
    expect(card.textContent).not.toContain(SECRET_VALUE);
    // the alert number is the outlet's own
    expect(within(card).getByText("+971500000001")).toBeInTheDocument();
  });

  it("missing credentials: the reason names what to add first", async () => {
    setup({ connections: [conn({ hasCredentials: false, locationVerified: true })] });
    render(<Page />);
    const card = await screen.findByRole("article", { name: "Deliveroo at Marina Branch" });
    expect(within(card).getByText("Add the marketplace credentials first.")).toBeInTheDocument();
    expect(within(card).getByRole("switch")).toBeDisabled();
    expect(within(card).getByText("Needs setup")).toBeInTheDocument();
  });

  it("verified connection can be turned on; the check shows, the row updates, and a failed check shows the API's words", async () => {
    const user = userEvent.setup();
    setup({ connections: [conn({ locationVerified: true })] });
    api.setChannelConnectionEnabled.mockRejectedValueOnce(new Error("Connection test failed: the marketplace did not accept the credentials"));
    render(<Page />);
    const card = await screen.findByRole("article", { name: "Deliveroo at Marina Branch" });
    const sw = within(card).getByRole("switch");
    expect(sw).toBeEnabled();
    await user.click(sw);
    expect(await within(card).findByText(/did not accept the credentials/)).toBeInTheDocument();
    expect(api.setChannelConnectionEnabled).toHaveBeenCalledWith(1, true);

    api.setChannelConnectionEnabled.mockResolvedValueOnce(conn({ locationVerified: true, enabled: true }));
    await user.click(within(card).getByRole("switch"));
    await waitFor(() => expect(within(card).getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(within(card).getByText("Live")).toBeInTheDocument();
    expect(within(card).getByText("Receiving orders")).toBeInTheDocument();
  });

  it("a live connection can always be turned off, even if verification was lost", async () => {
    const user = userEvent.setup();
    setup({ connections: [conn({ enabled: true, locationVerified: false })] });
    api.setChannelConnectionEnabled.mockResolvedValue(conn({ enabled: false }));
    render(<Page />);
    const sw = await screen.findByRole("switch");
    expect(sw).toBeEnabled();
    await user.click(sw);
    expect(api.setChannelConnectionEnabled).toHaveBeenCalledWith(1, false);
  });

  it("shows the last error as the API redacted it", async () => {
    setup({ connections: [conn({ lastError: "the marketplace did not accept the credentials for this location", lastSyncAt: "2026-10-13T00:00:00.000Z", lastSyncStatus: "failed" })] });
    render(<Page />);
    expect(await screen.findByText(/Last problem: the marketplace did not accept/)).toBeInTheDocument();
  });

  it("an outlet without a number says it will not be alerted", async () => {
    setup({ connections: [conn({ outletId: 6 })] });
    render(<Page />);
    expect(await screen.findByText(/will not be alerted when a marketplace order arrives/)).toBeInTheDocument();
  });

  it("flag off with an existing connection: still listed and manageable, adding is paused, turning on is blocked with the reason", async () => {
    setup({ flag: false, has: true, connections: [conn({ locationVerified: true })] });
    render(<Page />);
    expect(await screen.findByText(/New connections are paused/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add connection/i })).toBeDisabled();
    const card = await screen.findByRole("article", { name: "Deliveroo at Marina Branch" });
    expect(within(card).getByRole("switch")).toBeDisabled();
    expect(within(card).getByText("Marketplace channels are not available for your shop yet.")).toBeInTheDocument();
    // flag off means no outbound call, not even a connection test
    expect(within(card).getByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  it("with the flag on, Test connection is available and calls the test endpoint", async () => {
    const user = userEvent.setup();
    setup({ connections: [conn({ locationVerified: true })] });
    api.testChannelConnection.mockResolvedValue({ ok: true, message: null });
    render(<Page />);
    const card = await screen.findByRole("article", { name: "Deliveroo at Marina Branch" });
    await user.click(within(card).getByRole("button", { name: "Test connection" }));
    expect(api.testChannelConnection).toHaveBeenCalledWith(1);
  });

  it("delete shows the API's 409 as words and keeps the connection", async () => {
    const user = userEvent.setup();
    setup({ connections: [conn()] });
    api.deleteChannelConnection.mockRejectedValue(new Error("This connection has marketplace orders; disable it instead"));
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: "Delete Deliveroo at Marina Branch" }));
    await user.click(await screen.findByRole("button", { name: "Delete connection" }));
    expect(await screen.findByText("This connection has marketplace orders; disable it instead")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Deliveroo at Marina Branch" })).toBeInTheDocument();
  });

  describe("credentials are write-only", () => {
    it("create sends credentials only when typed, as a whole set, and never renders them back", async () => {
      const user = userEvent.setup();
      setup({ connections: [] });
      api.createChannelConnection.mockResolvedValue(conn());
      render(<Page />);
      await user.click(await screen.findByRole("button", { name: /add connection/i }));
      await user.type(screen.getByLabelText("Location ID"), "LOC-123");
      await user.type(screen.getByLabelText("Client ID"), "my-client");
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Add connection" }));
      expect(await screen.findByText(/Fill in every credential field/)).toBeInTheDocument();
      expect(api.createChannelConnection).not.toHaveBeenCalled();
      await user.type(screen.getByLabelText("Client secret"), SECRET_VALUE);
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add connection" }));
      await waitFor(() => expect(api.createChannelConnection).toHaveBeenCalledTimes(1));
      expect(api.createChannelConnection).toHaveBeenCalledWith({
        outletId: 5,
        provider: "deliveroo",
        externalLocationId: "LOC-123",
        credentials: { clientId: "my-client", clientSecret: SECRET_VALUE },
      });
      // the saved row shows only "Saved, hidden"
      const card = await screen.findByRole("article", { name: "Deliveroo at Marina Branch" });
      expect(document.body.textContent).not.toContain(SECRET_VALUE);
      expect(within(card).getByText("Saved, hidden")).toBeInTheDocument();
    });

    it("create with only the location id sends no credential keys at all", async () => {
      const user = userEvent.setup();
      setup({ connections: [] });
      api.createChannelConnection.mockResolvedValue(conn({ hasCredentials: false }));
      render(<Page />);
      await user.click(await screen.findByRole("button", { name: /add connection/i }));
      await user.type(screen.getByLabelText("Location ID"), "LOC-9");
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add connection" }));
      await waitFor(() => expect(api.createChannelConnection).toHaveBeenCalled());
      const sent = api.createChannelConnection.mock.calls[0][0] as Record<string, unknown>;
      expect(sent).toEqual({ outletId: 5, provider: "deliveroo", externalLocationId: "LOC-9" });
      expect("credentials" in sent).toBe(false);
      expect("webhookSecret" in sent).toBe(false);
    });

    it("editing an id with saved credentials never sends or shows them; Replace opens every field", async () => {
      const user = userEvent.setup();
      setup({ connections: [conn()] });
      api.updateChannelConnection.mockResolvedValue(conn({ externalLocationId: "LOC-777" }));
      render(<Page />);
      await user.click(await screen.findByRole("button", { name: "Edit Deliveroo at Marina Branch" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog as HTMLElement).queryByLabelText("Client secret")).not.toBeInTheDocument();
      expect(within(dialog as HTMLElement).getAllByText("Saved, hidden").length).toBeGreaterThanOrEqual(2);
      const loc = screen.getAllByLabelText("Location ID")[0];
      await user.clear(loc);
      await user.type(loc, "LOC-777");
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(api.updateChannelConnection).toHaveBeenCalledTimes(1));
      expect(api.updateChannelConnection).toHaveBeenCalledWith(1, { externalLocationId: "LOC-777" });
    });

    it("replacing credentials needs the whole set", async () => {
      const user = userEvent.setup();
      setup({ connections: [conn()] });
      api.updateChannelConnection.mockResolvedValue(conn());
      render(<Page />);
      await user.click(await screen.findByRole("button", { name: "Edit Deliveroo at Marina Branch" }));
      await user.click((await screen.findAllByRole("button", { name: "Replace" }))[0]);
      await user.type(screen.getByLabelText("Client ID"), "new-id");
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      expect(await screen.findByText(/fill in every credential field/i)).toBeInTheDocument();
      expect(api.updateChannelConnection).not.toHaveBeenCalled();
      await user.type(screen.getByLabelText("Client secret"), SECRET_VALUE);
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(api.updateChannelConnection).toHaveBeenCalledWith(1, { credentials: { clientId: "new-id", clientSecret: SECRET_VALUE } }));
    });

    it("a live connection cannot be edited, with the reason", async () => {
      const user = userEvent.setup();
      setup({ connections: [conn({ enabled: true, locationVerified: true })] });
      render(<Page />);
      await user.click(await screen.findByRole("button", { name: "Edit Deliveroo at Marina Branch" }));
      expect(await screen.findByText(/This connection is live, so its location, credentials and webhook secret cannot be changed/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    });
  });

  describe("unmapped items queue", () => {
    const item: ChannelUnmappedItem = {
      id: 9,
      provider: "deliveroo",
      externalItemId: "pos-77",
      externalName: "Rose Bouquet",
      occurrences: 3,
      firstSeenAt: "2026-10-13T00:00:00.000Z",
      lastSeenAt: "2026-10-13T00:00:00.000Z",
      resolvedAt: null,
      waitingOrders: [{ channelOrderId: 4, displayId: "A12", externalOrderId: "ext-4", acceptBy: null }],
    };
    const product = { id: 31, name: "Red Roses", sku: "RR-1", hasVariants: false, options: [], variants: [] } as unknown as Product;
    const variantProduct = {
      id: 32,
      name: "Tulips",
      sku: "TU-1",
      hasVariants: true,
      options: [{ id: 1 }],
      variants: [{ id: 501, label: "Large", sku: "TU-L" }],
    } as unknown as Product;

    it("lists the item with the orders waiting on it and explains that nothing is auto-created", async () => {
      setup({ connections: [conn()], unmapped: [item] });
      api.listProducts.mockResolvedValue([product]);
      render(<Page />);
      expect(await screen.findByText("Rose Bouquet")).toBeInTheDocument();
      expect(screen.getByText(/1 order is waiting on this item/)).toBeInTheDocument();
      expect(screen.getByText("Order #A12")).toBeInTheDocument();
      expect(screen.getByText(/Nothing is created for you/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save link" })).toBeDisabled();
    });

    it("saves a product link, reports the orders it released, and a failure offers Retry", async () => {
      const user = userEvent.setup();
      setup({ connections: [conn()], unmapped: [item] });
      api.listProducts.mockResolvedValue([product]);
      api.resolveChannelUnmappedItem.mockRejectedValueOnce(new Error("A gift card cannot be a marketplace item"));
      render(<Page />);
      await screen.findByText("Rose Bouquet");
      await user.click(screen.getByRole("combobox", { name: "Your product" }));
      await user.click(await screen.findByRole("option", { name: /Red Roses/ }));
      await user.click(screen.getByRole("button", { name: "Save link" }));
      expect(await screen.findByText("A gift card cannot be a marketplace item")).toBeInTheDocument();
      expect(api.resolveChannelUnmappedItem).toHaveBeenCalledWith(9, { productId: 31 });
      api.resolveChannelUnmappedItem.mockResolvedValueOnce({ ordersCreated: 1 });
      api.listChannelUnmappedItems.mockResolvedValue([]);
      await user.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/1 order is now waiting for you to accept/)));
      expect(await screen.findByText("Nothing is waiting to be linked")).toBeInTheDocument();
    });

    it("a product with variants needs a variant before saving", async () => {
      const user = userEvent.setup();
      setup({ connections: [conn()], unmapped: [item] });
      api.listProducts.mockResolvedValue([variantProduct]);
      api.resolveChannelUnmappedItem.mockResolvedValue({ ordersCreated: 0 });
      render(<Page />);
      await screen.findByText("Rose Bouquet");
      await user.click(screen.getByRole("combobox", { name: "Your product" }));
      await user.click(await screen.findByRole("option", { name: /Tulips/ }));
      expect(screen.getByRole("button", { name: "Save link" })).toBeDisabled();
      await user.click(screen.getByRole("combobox", { name: "Variant" }));
      await user.click(await screen.findByRole("option", { name: "Large" }));
      await user.click(screen.getByRole("button", { name: "Save link" }));
      await waitFor(() => expect(api.resolveChannelUnmappedItem).toHaveBeenCalledWith(9, { productId: 32, variantId: 501 }));
    });
  });
});
