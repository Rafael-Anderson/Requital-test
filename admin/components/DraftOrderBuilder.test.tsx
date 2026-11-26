import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DraftOrderBuilder, { buildDraftPayload, draftFormProblems, type WorkingItem } from "./DraftOrderBuilder";
import { ToastProvider } from "@/components/ui/Toast";
import type { DraftBill, Outlet, Product } from "@/lib/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/api", () => ({
  listOutlets: vi.fn(),
  listProductsPage: vi.fn(),
  listCustomers: vi.fn(),
  getCustomer: vi.fn(),
  previewDraftOrder: vi.fn(),
  createDraftOrder: vi.fn(),
  updateDraftOrder: vi.fn(),
  getRegions: vi.fn(),
}));

import { createDraftOrder, getRegions, listOutlets, listProductsPage, previewDraftOrder } from "@/lib/api";

const outlets: Outlet[] = [{ id: 1, name: "Main Branch" } as Outlet];
const rose = { id: 7, name: "Rose Bouquet", hasVariants: false, price: "50", thumbnail: "", stockQuantity: 3, variants: [] } as unknown as Product;

const bill = (over: Partial<DraftBill> = {}): DraftBill => ({
  currency: "AED",
  taxInclusive: false,
  lines: [],
  subtotal: "0",
  discount: { amount: "0", source: null, code: null, reason: null },
  deliveryFee: "15",
  deliveryFeeSource: "zone",
  deliveryZone: "Dubai",
  deliveryError: null,
  taxAmount: "0",
  total: "15",
  stockWarnings: [],
  ...over,
});

function renderBuilder() {
  vi.mocked(listOutlets).mockResolvedValue(outlets);
  vi.mocked(getRegions).mockResolvedValue({ country: null, regions: [] } as never);
  vi.mocked(listProductsPage).mockResolvedValue({ data: [rose], page: 1, pageSize: 8, total: 1 });
  return render(
    <ToastProvider>
      <DraftOrderBuilder />
    </ToastProvider>,
  );
}

const baseForm = {
  outletId: 1,
  customerName: "Layla",
  customerPhone: "0501112233",
  customerEmail: "",
  orderType: "delivery" as const,
  customerAddress: "Villa 7",
  regionId: null,
  area: "",
  deliveryDate: "",
  deliveryTimeSlot: "",
  receiverOn: false,
  receiverName: "",
  receiverPhone: "",
  receiverMessage: "",
  discountMode: "none" as const,
  discountCode: "",
  orderDiscountType: "percent" as const,
  orderDiscountValue: "",
  orderDiscountReason: "",
  feeOverrideOn: false,
  feeOverride: "",
  feeOverrideReason: "",
  notes: "",
  customerNote: "",
  items: [] as WorkingItem[],
};
const line = (over: Partial<WorkingItem>): WorkingItem => ({
  key: "k",
  custom: false,
  name: "",
  quantity: 1,
  price: null,
  priceReason: "",
  taxable: true,
  ...over,
});

describe("draft builder payload and rules", () => {
  it("a changed catalogue price needs a reason; a custom item needs a name and a price", () => {
    expect(
      draftFormProblems({ ...baseForm, items: [line({ productId: 7, price: "40" })] }),
    ).toContain("Line 1: give a reason for the changed price");
    expect(
      draftFormProblems({ ...baseForm, items: [line({ productId: 7, price: "40", priceReason: "Loyal" })] }),
    ).toEqual([]);
    expect(draftFormProblems({ ...baseForm, items: [line({ custom: true, price: "" })] })).toEqual([
      "Line 1: give the custom item a name",
      "Line 1: give the custom item a price",
    ]);
  });

  it("sends a custom item as customName + price + taxable, and a live-priced line without a price", () => {
    const payload = buildDraftPayload({
      ...baseForm,
      items: [
        line({ productId: 7 }),
        line({ custom: true, name: "Card", price: "10", taxable: false }),
      ],
    });
    expect(payload.items).toEqual([
      { productId: 7, variantId: undefined, quantity: 1 },
      { customName: "Card", price: 10, quantity: 1, taxable: false },
    ]);
  });

  it("pickup sends no address, region or fee override", () => {
    const payload = buildDraftPayload({ ...baseForm, orderType: "pickup", feeOverrideOn: true, feeOverride: "5", feeOverrideReason: "x" });
    expect(payload.customerAddress).toBeUndefined();
    expect(payload.deliveryFeeOverride).toBeNull();
  });
});

describe("DraftOrderBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds a custom item and shows the bill split the backend priced", async () => {
    vi.mocked(previewDraftOrder).mockResolvedValue(
      bill({
        lines: [
          { productId: 1, variantId: null, name: "Hand-written card", variantLabel: null, quantity: 1, unitPrice: "10", lineTotal: "10", taxRate: 0, custom: true, priceOverridden: false, priceReason: null },
        ],
        subtotal: "10",
        total: "25",
      }),
    );
    renderBuilder();
    await screen.findByText("Main Branch");
    fireEvent.click(screen.getByRole("button", { name: /Custom item/ }));
    fireEvent.change(screen.getByLabelText("Custom item name"), { target: { value: "Hand-written card" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "10" } });
    await waitFor(() => expect(previewDraftOrder).toHaveBeenCalled(), { timeout: 2000 });
    const sent = vi.mocked(previewDraftOrder).mock.calls.at(-1)![0];
    expect(sent.items).toEqual([{ customName: "Hand-written card", price: 10, quantity: 1, taxable: true }]);
    const split = await screen.findByTestId("bill-split");
    await waitFor(() => expect(split.textContent).toContain("Hand-written card"));
    expect(split.textContent).toContain("25");
  });

  it("a changed price is refused without a reason and the draft is not saved", async () => {
    vi.mocked(previewDraftOrder).mockResolvedValue(bill());
    renderBuilder();
    await screen.findByText("Main Branch");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Layla" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "0501112233" } });
    fireEvent.change(screen.getByLabelText("Add a product"), { target: { value: "Rose" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    fireEvent.click(await screen.findByRole("button", { name: "Change price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    expect(screen.getByText("A reason is required")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect((await screen.findAllByText("Line 1: give a reason for the changed price")).length).toBeGreaterThan(0);
    expect(createDraftOrder).not.toHaveBeenCalled();
  });

  it("shows the stock warning the backend returns", async () => {
    vi.mocked(previewDraftOrder).mockResolvedValue(
      bill({ stockWarnings: [{ productId: 7, variantId: null, name: "Rose Bouquet", requested: 5, available: 3 }] }),
    );
    renderBuilder();
    await screen.findByText("Main Branch");
    fireEvent.change(screen.getByLabelText("Add a product"), { target: { value: "Rose" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    expect(await screen.findByText(/5 requested, 3 in stock/, {}, { timeout: 2000 })).toBeInTheDocument();
  });
});
