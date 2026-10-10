import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StoreCreditCard from "./StoreCreditCard";
import { ToastProvider } from "@/components/ui/Toast";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({ getCustomerStoreCredit: vi.fn(), adjustCustomerStoreCredit: vi.fn() }));
vi.mock("@/lib/useShopCurrency", () => ({ useShopCurrency: () => "AED" }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const overview = {
  balances: [
    { currency: "AED", balance: "20.00", balanceMinor: 2000, entries: 1 },
    { currency: "KWD", balance: "5.500", balanceMinor: 5500, entries: 1 },
  ],
  entries: [],
};
const wrap = (canEdit = true) =>
  render(
    <ToastProvider>
      <StoreCreditCard customerId={1} canEdit={canEdit} />
    </ToastProvider>,
  );

describe("StoreCreditCard", () => {
  it("lists a balance per currency and never adds them together", async () => {
    vi.mocked(api.getCustomerStoreCredit).mockResolvedValue(overview);
    wrap();
    expect(await screen.findByText("20.00")).toBeInTheDocument();
    expect(screen.getByText("5.500")).toBeInTheDocument();
  });

  it("needs an amount and a reason, sends a stable idempotency key, and renews it after success", async () => {
    vi.mocked(api.getCustomerStoreCredit).mockResolvedValue(overview);
    vi.mocked(api.adjustCustomerStoreCredit).mockResolvedValue(overview);
    wrap();
    await screen.findByText("20.00");
    const submit = screen.getByRole("button", { name: "Add credit" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Amount"), "10.50");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Reason (required)"), "goodwill");
    await userEvent.click(submit);
    await waitFor(() => expect(api.adjustCustomerStoreCredit).toHaveBeenCalledTimes(1));
    const first = vi.mocked(api.adjustCustomerStoreCredit).mock.calls[0][1];
    expect(first).toMatchObject({ currency: "AED", amount: "10.50", direction: "grant", reason: "goodwill" });
    expect(first.idempotencyKey).toMatch(/\S{8,}/);
    await userEvent.type(screen.getByLabelText("Amount"), "1");
    await userEvent.type(screen.getByLabelText("Reason (required)"), "again");
    await userEvent.click(screen.getByRole("button", { name: "Add credit" }));
    await waitFor(() => expect(api.adjustCustomerStoreCredit).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.adjustCustomerStoreCredit).mock.calls[1][1].idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("shows the server's refusal (balance below zero) and keeps the form", async () => {
    vi.mocked(api.getCustomerStoreCredit).mockResolvedValue(overview);
    vi.mocked(api.adjustCustomerStoreCredit).mockRejectedValue(new Error("This would take the balance below zero"));
    wrap();
    await screen.findByText("20.00");
    await userEvent.selectOptions(screen.getByLabelText("Action"), "deduct");
    await userEvent.type(screen.getByLabelText("Amount"), "99");
    await userEvent.type(screen.getByLabelText("Reason (required)"), "correction");
    await userEvent.click(screen.getByRole("button", { name: "Deduct credit" }));
    expect(await screen.findByText(/would take the balance below zero/)).toBeInTheDocument();
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("99");
  });

  it("gives a viewer the numbers but no controls, and retries a failed load", async () => {
    vi.mocked(api.getCustomerStoreCredit).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(overview);
    wrap(false);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("20.00")).toBeInTheDocument();
    expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
  });
});
