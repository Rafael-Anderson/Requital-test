import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderInvoiceTab from "./OrderInvoiceTab";
import { ToastProvider } from "@/components/ui/Toast";
import type { Invoice } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  listInvoicesForOrder: vi.fn(),
  generateInvoice: vi.fn(),
  getInvoiceHtml: vi.fn(),
}));

import { generateInvoice, getInvoiceHtml, listInvoicesForOrder } from "@/lib/api";

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
