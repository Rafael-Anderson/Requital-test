import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({ scan: vi.fn(), receive: vi.fn() }));
vi.mock("@/lib/api", () => ({
  scanPurchaseOrderLine: api.scan,
  receivePurchaseOrder: api.receive,
}));
import { ToastProvider } from "@/components/ui/Toast";
import ScanReceiveModal from "./ScanReceiveModal";
import type { PurchaseOrderDetail } from "@/lib/types";

const po = {
  id: 5,
  poNumber: "PO-0005",
  currency: "AED",
  lines: [
    { id: 11, description: "Rose", quantityOrdered: 3, quantityReceived: 0, unitCost: "2", currency: "AED", ingredientId: 1 },
    { id: 12, description: "Fern", quantityOrdered: 2, quantityReceived: 1, unitCost: "1", currency: "AED", ingredientId: 2 },
  ],
} as unknown as PurchaseOrderDetail;
const ok = (lineId: number) => ({ line: { id: lineId }, quantity: 1, outstandingAfter: 1 });

beforeEach(() => {
  api.scan.mockReset();
  api.receive.mockReset();
});
afterEach(cleanup);

const mount = (onReceived = vi.fn()) =>
  render(
    <ToastProvider>
      <ScanReceiveModal po={po} onClose={() => {}} onReceived={onReceived} />
    </ToastProvider>,
  );

describe("ScanReceiveModal", () => {
  it("sends the running tally with each scan, builds the tally, and commits it through the receive endpoint", async () => {
    api.scan.mockResolvedValueOnce(ok(11)).mockResolvedValueOnce(ok(11)).mockResolvedValueOnce(ok(12));
    api.receive.mockResolvedValue({});
    const onReceived = vi.fn();
    const user = userEvent.setup();
    mount(onReceived);
    for (const code of ["A1", "A1", "B2"]) {
      await user.type(screen.getByLabelText("Barcode or SKU"), `${code}{Enter}`);
      await waitFor(() => expect(screen.getByLabelText("Barcode or SKU")).toHaveValue(""));
    }
    expect(api.scan).toHaveBeenNthCalledWith(1, 5, { code: "A1", pending: [] });
    expect(api.scan).toHaveBeenNthCalledWith(2, 5, { code: "A1", pending: [{ lineId: 11, quantity: 1 }] });
    expect(api.scan).toHaveBeenNthCalledWith(3, 5, { code: "B2", pending: [{ lineId: 11, quantity: 2 }] });
    await user.click(screen.getByRole("button", { name: "Receive 3 scanned" }));
    await waitFor(() => expect(api.receive).toHaveBeenCalledTimes(1));
    const [id, body] = api.receive.mock.calls[0] as [number, { lines: unknown[]; idempotencyKey: string }];
    expect(id).toBe(5);
    expect(body.lines).toEqual([
      { lineId: 11, quantity: 2 },
      { lineId: 12, quantity: 1 },
    ]);
    expect(body.idempotencyKey).toBeTruthy();
    await waitFor(() => expect(onReceived).toHaveBeenCalled());
  });

  it("shows the server's reason for a rejected scan and does not add to the tally", async () => {
    api.scan.mockRejectedValue(new Error('"ZZZ" does not match any line on PO-0005'));
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Barcode or SKU"), "ZZZ{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("does not match any line");
    expect(screen.getByRole("button", { name: /^Receive/ })).toBeDisabled();
  });

  it("a failed commit retried with an unchanged tally reuses the idempotency key; a changed tally takes a new one", async () => {
    api.scan.mockResolvedValue(ok(11));
    api.receive.mockRejectedValueOnce(new Error("network")).mockRejectedValueOnce(new Error("network")).mockResolvedValue({});
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Barcode or SKU"), "A1{Enter}");
    await user.click(await screen.findByRole("button", { name: "Receive 1 scanned" }));
    await waitFor(() => expect(api.receive).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole("button", { name: "Receive 1 scanned" }));
    await waitFor(() => expect(api.receive).toHaveBeenCalledTimes(2));
    const k = (n: number) => (api.receive.mock.calls[n] as [number, { idempotencyKey: string }])[1].idempotencyKey;
    expect(k(1)).toBe(k(0));
    await user.type(screen.getByLabelText("Barcode or SKU"), "A1{Enter}");
    await user.click(await screen.findByRole("button", { name: "Receive 2 scanned" }));
    await waitFor(() => expect(api.receive).toHaveBeenCalledTimes(3));
    expect(k(2)).not.toBe(k(0));
  });
});
