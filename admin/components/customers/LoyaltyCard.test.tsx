import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoyaltyCard from "./LoyaltyCard";
import { ToastProvider } from "@/components/ui/Toast";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({ getCustomerLoyalty: vi.fn(), adjustCustomerLoyalty: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const overview = {
  available: true as const,
  programEnabled: true,
  balance: 120,
  entries: [
    { id: 1, type: "earn" as const, points: 120, shortfall: 0, reason: null, orderId: 5, orderNumber: 7, returnId: null, actorName: null, createdAt: "2026-10-01T10:00:00Z" },
  ],
};
const wrap = (canEdit = true) =>
  render(
    <ToastProvider>
      <LoyaltyCard customerId={1} canEdit={canEdit} />
    </ToastProvider>,
  );

describe("LoyaltyCard", () => {
  it("renders nothing when the platform has not granted loyalty", async () => {
    vi.mocked(api.getCustomerLoyalty).mockResolvedValue({ available: false });
    const { container } = wrap();
    await waitFor(() => expect(api.getCustomerLoyalty).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("shows the balance and needs a whole non-zero number and a reason", async () => {
    vi.mocked(api.getCustomerLoyalty).mockResolvedValue(overview);
    vi.mocked(api.adjustCustomerLoyalty).mockResolvedValue(overview);
    wrap();
    expect(await screen.findByText("120")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Update points" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Points \(use a minus/), "1.5");
    await userEvent.type(screen.getByLabelText("Reason (required)"), "goodwill");
    expect(submit).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Points \(use a minus/));
    await userEvent.type(screen.getByLabelText(/Points \(use a minus/), "-20");
    await userEvent.click(submit);
    await waitFor(() => expect(api.adjustCustomerLoyalty).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.adjustCustomerLoyalty).mock.calls[0][1]).toMatchObject({ points: -20, reason: "goodwill" });
  });

  it("hides the form from a read-only user", async () => {
    vi.mocked(api.getCustomerLoyalty).mockResolvedValue(overview);
    wrap(false);
    await screen.findByText("120");
    expect(screen.queryByRole("button", { name: "Update points" })).toBeNull();
  });
});
