import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => {
  class DriverApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public code?: string,
    ) {
      super(message);
    }
  }
  return {
    DriverApiError,
    driverGetRun: vi.fn(),
    driverSendCode: vi.fn(),
    driverUploadPhoto: vi.fn(),
    driverDeliver: vi.fn(),
    driverFail: vi.fn(),
  };
});
vi.mock("@/lib/driver-api", () => api);
vi.mock("next/navigation", () => ({ useParams: () => ({ token: "T".repeat(43) }) }));

import Page from "./page";

const stop = (over: Record<string, unknown> = {}) => ({
  id: 5,
  position: 1,
  status: "pending",
  failureReason: null,
  orderNumber: 12,
  customerName: "Layla",
  customerPhone: "0501112233",
  address: "Villa 12, Jumeirah",
  deliveryNotes: "Ring twice",
  timeSlot: null,
  items: ["2 x Roses"],
  deliverable: true,
  orderCancelled: false,
  cod: null,
  proof: { hasPhoto: false, codActive: false, codSendsLeft: 3 },
  cashDiscrepancy: false,
  ...over,
});
const view = (stops: unknown[], proofRequirement = "photo_or_otp") => ({
  shopName: "Petals",
  driverName: "Omar",
  run: { status: "dispatched", proofRequirement },
  stops,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("driver page", () => {
  it("shows what the job needs, with tap-to-call and a maps link", async () => {
    api.driverGetRun.mockResolvedValue(view([stop()]));
    render(<Page />);
    await screen.findByText("Layla");
    expect(screen.getByRole("link", { name: "0501112233" }).getAttribute("href")).toBe("tel:0501112233");
    const maps = screen.getByRole("link", { name: "Open in Maps" });
    expect(maps.getAttribute("rel")).toContain("noreferrer");
    expect(screen.queryByLabelText(/Cash collected/)).toBeNull(); // not a COD stop
    expect(api.driverGetRun).toHaveBeenCalledWith("T".repeat(43));
  });

  it("asks for the cash on a COD stop and sends it with the delivery", async () => {
    api.driverGetRun.mockResolvedValue(view([stop({ cod: { amount: "100.00", currency: "AED", alreadyCollected: false } })]));
    api.driverDeliver.mockResolvedValue({ status: "delivered", runCompleted: false });
    render(<Page />);
    await screen.findByText("Collect 100.00 AED");
    await userEvent.type(screen.getByLabelText(/Cash collected/), "100.00");
    await userEvent.type(screen.getByLabelText("Customer code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Mark delivered" }));
    await waitFor(() => expect(api.driverDeliver).toHaveBeenCalledWith("T".repeat(43), 5, { code: "123456", cashCollected: "100.00" }));
  });

  it("shows the server's reason when a delivery is refused", async () => {
    api.driverGetRun.mockResolvedValue(view([stop()]));
    api.driverDeliver.mockRejectedValue(new api.DriverApiError("Take a delivery photo or enter the customer's code first", 400, "proof_required"));
    render(<Page />);
    await screen.findByText("Layla");
    await userEvent.click(screen.getByRole("button", { name: "Mark delivered" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Take a delivery photo");
  });

  it("does not offer a cancelled order for delivery", async () => {
    api.driverGetRun.mockResolvedValue(view([stop({ deliverable: false, orderCancelled: true })]));
    render(<Page />);
    await screen.findByText(/Do not hand it over/);
    expect(screen.queryByRole("button", { name: "Mark delivered" })).toBeNull();
  });

  it("treats a 404 as a closed link, the same for every cause", async () => {
    api.driverGetRun.mockRejectedValue(new api.DriverApiError("Not found", 404));
    render(<Page />);
    await screen.findByText("This link is no longer active");
  });

  it("leaves the loading state with Try again when the request fails", async () => {
    api.driverGetRun.mockRejectedValueOnce(new api.DriverApiError("x", 500)).mockResolvedValue(view([stop()]));
    render(<Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByText("Layla");
  });
});
