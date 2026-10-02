import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SupplierFormModal from "./SupplierFormModal";
import type { SupplierDetail } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
}));
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));

import { createSupplier } from "@/lib/api";

const SAVED = { id: 5, name: "Bloom Co" } as SupplierDetail;

describe("SupplierFormModal", () => {
  beforeEach(() => vi.clearAllMocks());

  // Unknown stays unknown: nothing blank is turned into a default currency.
  it("sends null for every blank optional field, including currency", async () => {
    const user = userEvent.setup();
    vi.mocked(createSupplier).mockResolvedValue(SAVED);
    const onSaved = vi.fn();
    render(<SupplierFormModal supplier={null} onClose={vi.fn()} onSaved={onSaved} />);

    await user.type(screen.getByLabelText("Name"), "Bloom Co");
    await user.click(screen.getByText("Add supplier"));

    await waitFor(() => {
      expect(createSupplier).toHaveBeenCalledWith({
        name: "Bloom Co",
        paymentTerms: null,
        leadTimeDays: null,
        currency: null,
        minimumOrderAmount: null,
        notes: null,
      });
    });
    expect(onSaved).toHaveBeenCalledWith(5);
  });

  it("refuses a minimum order amount with no currency before calling the API", async () => {
    const user = userEvent.setup();
    render(<SupplierFormModal supplier={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Bloom Co");
    await user.type(screen.getByLabelText("Minimum order amount"), "50");
    await user.click(screen.getByText("Add supplier"));

    expect(await screen.findByText(/Choose a currency/)).toBeInTheDocument();
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it("sends the chosen currency with the minimum", async () => {
    const user = userEvent.setup();
    vi.mocked(createSupplier).mockResolvedValue(SAVED);
    render(<SupplierFormModal supplier={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Name"), "Bloom Co");
    await user.selectOptions(screen.getByLabelText("Currency"), "KWD");
    await user.type(screen.getByLabelText("Minimum order amount"), "10.505");
    await user.click(screen.getByText("Add supplier"));

    await waitFor(() => {
      expect(createSupplier).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "KWD", minimumOrderAmount: 10.505 }),
      );
    });
  });
});
