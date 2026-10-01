import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderInvoiceTab from "./OrderInvoiceTab";
import { ToastProvider } from "@/components/ui/Toast";
import type { Invoice } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  listInvoicesForOrder: vi.fn(),
  generateInvoice: vi.fn(),
  getInvoiceHtml: vi.fn(),
  listCreditNotesForOrder: vi.fn(),
  getOrderReturns: vi.fn(),
  issueCreditNote: vi.fn(),
  getCreditNoteHtml: vi.fn(),
}));

import {
  generateInvoice,
  getCreditNoteHtml,
  getInvoiceHtml,
  getOrderReturns,
  issueCreditNote,
  listCreditNotesForOrder,
  listInvoicesForOrder,
} from "@/lib/api";
import type { CreditNote } from "@/lib/types";

beforeEach(() => {
  vi.mocked(listCreditNotesForOrder).mockResolvedValue([]);
  vi.mocked(getOrderReturns).mockResolvedValue([]);
});

function renderTab(orderId = 1) {
  return render(
    <ToastProvider>
      <OrderInvoiceTab orderId={orderId} />
    </ToastProvider>,
  );
}

const invoice: Invoice = {
  id: 10,
  orderId: 1,
  shopId: 1,
  type: "INVOICE",
  invoiceNumber: "INV-0001",
  issuedAt: "2026-01-01T00:00:00.000Z",
  subtotal: "100.00",
  taxAmount: "5.00",
  total: "105.00",
  notes: null,
  supersededAt: null,
};

describe("OrderInvoiceTab", () => {
  it("shows Generate buttons for both types when no invoice exists yet", async () => {
    vi.mocked(listInvoicesForOrder).mockResolvedValue([]);
    renderTab();

    await waitFor(() => expect(screen.getByText("Generate Invoice")).toBeInTheDocument());
    expect(screen.getByText("Generate Packing Slip")).toBeInTheDocument();
    expect(screen.queryByTitle(/preview/i)).not.toBeInTheDocument();
  });

  it("clicking Generate Invoice calls generateInvoice with the order id and type, then shows the preview iframe", async () => {
    const user = userEvent.setup();
    vi.mocked(listInvoicesForOrder).mockResolvedValue([]);
    vi.mocked(generateInvoice).mockResolvedValue(invoice);
    vi.mocked(getInvoiceHtml).mockResolvedValue("<html><body>Invoice INV-0001</body></html>");
    renderTab(1);

    await waitFor(() => expect(screen.getByText("Generate Invoice")).toBeInTheDocument());
    await user.click(screen.getByText("Generate Invoice"));

    expect(generateInvoice).toHaveBeenCalledWith(1, "INVOICE");
    await waitFor(() => expect(getInvoiceHtml).toHaveBeenCalledWith(10));
    await waitFor(() => expect(screen.getByTitle("Invoice preview")).toBeInTheDocument());
  });

  it("if an invoice already exists, shows a View button (not Generate) and loads its preview immediately", async () => {
    vi.mocked(listInvoicesForOrder).mockResolvedValue([invoice]);
    vi.mocked(getInvoiceHtml).mockResolvedValue("<html><body>Invoice INV-0001</body></html>");
    renderTab(1);

    await waitFor(() =>
      expect(screen.getByText("View Invoice (INV-0001)")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Generate Invoice")).not.toBeInTheDocument();
    expect(screen.getByText("Generate Packing Slip")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTitle("Invoice preview")).toBeInTheDocument());
  });
});


describe("OrderInvoiceTab superseded marker (C2)", () => {
  // The document is frozen at issue, so after an edit it correctly no longer
  // matches the order. Staff have to see that before handing it to a customer.
  it("warns when the invoice predates the current order", async () => {
    vi.mocked(listInvoicesForOrder).mockResolvedValue([
      { ...invoice, supersededAt: "2026-09-30T10:00:00.000Z" },
    ]);
    renderTab();
    expect(
      await screen.findByText(/predates the current order/i),
    ).toBeInTheDocument();
  });

  it("says nothing when the invoice still describes its order", async () => {
    vi.mocked(listInvoicesForOrder).mockResolvedValue([invoice]);
    renderTab();
    await screen.findByText(/View Invoice/);
    expect(
      screen.queryByText(/predates the current order/i),
    ).not.toBeInTheDocument();
  });

  // A packing slip renders live, so it is never marked and must never trigger
  // the warning.
  it("never warns for a packing slip", async () => {
    vi.mocked(listInvoicesForOrder).mockResolvedValue([
      { ...invoice, type: "PACKING_SLIP", supersededAt: null },
    ]);
    renderTab();
    await screen.findByText(/View Packing Slip/);
    expect(
      screen.queryByText(/predates the current order/i),
    ).not.toBeInTheDocument();
  });

  describe("credit notes", () => {
    const note: CreditNote = {
      id: 7,
      orderId: 1,
      invoiceId: 10,
      number: "CN-0001",
      reason: "correction",
      returnId: null,
      currency: "KWD",
      subtotal: "10.505",
      taxAmount: "0.525",
      total: "11.030",
      createdAt: "2026-01-02T00:00:00.000Z",
    };

    it("is hidden until an invoice exists", async () => {
      vi.mocked(listInvoicesForOrder).mockResolvedValue([]);
      renderTab();
      await waitFor(() => expect(screen.getByText("Generate Invoice")).toBeInTheDocument());
      expect(screen.queryByText("Issue credit note")).not.toBeInTheDocument();
    });

    it("lists notes in their own currency and issues a full credit note", async () => {
      const user = userEvent.setup();
      vi.mocked(listInvoicesForOrder).mockResolvedValue([invoice]);
      vi.mocked(getInvoiceHtml).mockResolvedValue("<html></html>");
      vi.mocked(listCreditNotesForOrder).mockResolvedValue([note]);
      vi.mocked(issueCreditNote).mockResolvedValue({ ...note, id: 8, number: "CN-0002" });
      vi.mocked(getCreditNoteHtml).mockResolvedValue("<html>Credit Note</html>");
      renderTab(1);

      // KWD keeps three decimals.
      await waitFor(() => expect(screen.getByText("CN-0001 (11.030 KWD)")).toBeInTheDocument());
      await user.click(screen.getByText("Issue credit note"));
      expect(issueCreditNote).toHaveBeenCalledWith({
        orderId: 1,
        reason: "correction",
        returnId: undefined,
      });
      await waitFor(() => expect(getCreditNoteHtml).toHaveBeenCalledWith(8));
      await waitFor(() => expect(screen.getByTitle("Credit note preview")).toBeInTheDocument());
    });
  });
});
