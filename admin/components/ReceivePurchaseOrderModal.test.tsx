import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReceivePurchaseOrderModal from "./ReceivePurchaseOrderModal";
import type { PurchaseOrderDetail } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({ receivePurchaseOrder: vi.fn() }));
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));

import { receivePurchaseOrder } from "@/lib/api";

const PO = {
  id: 9,
  poNumber: "PO-0009",
  currency: "KWD",
  lines: [
    {
      id: 21,
      ingredientId: 4,
      productId: null,
      variantId: null,
      supplierSku: null,
      description: "White rose",
      quantityOrdered: 10,
      quantityReceived: 4,
      unitCost: "2.5",
      currency: "KWD",
      lineTotal: "25",
    },
  ],
} as unknown as PurchaseOrderDetail;

describe("ReceivePurchaseOrderModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to the outstanding quantity, omits an unchanged cost and sends an idempotency key", async () => {
    const user = userEvent.setup();
    vi.mocked(receivePurchaseOrder).mockResolvedValue({ receiptId: 1, replayed: false, purchaseOrder: PO });
    const onReceived = vi.fn();
    render(<ReceivePurchaseOrderModal po={PO} onClose={vi.fn()} onReceived={onReceived} />);

    expect(screen.getByLabelText("Received")).toHaveValue(6);
    await user.click(screen.getByText("Receive into stock"));

    await waitFor(() => expect(receivePurchaseOrder).toHaveBeenCalledTimes(1));
    const body = vi.mocked(receivePurchaseOrder).mock.calls[0][1];
    expect(body.lines).toEqual([{ lineId: 21, quantity: 6 }]);
    expect(typeof body.idempotencyKey).toBe("string");
    expect(onReceived).toHaveBeenCalled();
  });

  it("sends the cost actually invoiced when it differs, and the input's max blocks an over-receipt before calling the API", async () => {
    const user = userEvent.setup();
    vi.mocked(receivePurchaseOrder).mockResolvedValue({ receiptId: 1, replayed: false, purchaseOrder: PO });
    render(<ReceivePurchaseOrderModal po={PO} onClose={vi.fn()} onReceived={vi.fn()} />);

    const qty = screen.getByLabelText("Received");
    await user.clear(qty);
    await user.type(qty, "7");
    await user.click(screen.getByText("Receive into stock"));
    expect(qty).toBeInvalid();
    expect(receivePurchaseOrder).not.toHaveBeenCalled();

    await user.clear(qty);
    await user.type(qty, "3");
    const cost = screen.getByLabelText("Cost (KWD)");
    await user.clear(cost);
    await user.type(cost, "2.625");
    await user.click(screen.getByText("Receive into stock"));
    await waitFor(() => expect(receivePurchaseOrder).toHaveBeenCalledTimes(1));
    expect(vi.mocked(receivePurchaseOrder).mock.calls[0][1].lines).toEqual([{ lineId: 21, quantity: 3, unitCost: 2.625 }]);
  });
});
