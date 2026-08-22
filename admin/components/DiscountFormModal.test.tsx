import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiscountFormModal from "./DiscountFormModal";
import type { Discount } from "@/lib/types";

const createDiscount = vi.fn();
const updateDiscount = vi.fn();

vi.mock("@/lib/api", () => ({
  createDiscount: (...args: unknown[]) => createDiscount(...args),
  updateDiscount: (...args: unknown[]) => updateDiscount(...args),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

function fixtureDiscount(overrides: Partial<Discount> = {}): Discount {
  return {
    id: 1,
    code: "SUMMER10",
    discountType: "code",
    type: "PERCENTAGE",
    value: "10",
    minPurchaseAmount: null,
    appliesTo: "ALL_PRODUCTS",
    products: [],
    collections: [],
    usageLimit: null,
    usageLimitPerCustomer: null,
    startsAt: null,
    endsAt: null,
    active: true,
    timesUsed: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const products = [{ id: 1, name: "Rose Bouquet" } as never];
const collections = [{ id: 5, name: "Best Sellers" } as never];

describe("DiscountFormModal — requires-code toggle", () => {
  it("defaults to on (code-based) for a new discount, showing the Code input", () => {
    render(<DiscountFormModal discount={null} products={products} collections={collections} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Code")).toBeInTheDocument();
  });

  it("toggling off hides the Code input, removes 'All products' from Applies to, and shows the auto-apply hint", async () => {
    const user = userEvent.setup();
    render(<DiscountFormModal discount={null} products={products} collections={collections} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getAllByRole("switch")[0]);

    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
    expect(screen.getByText(/applies automatically to every matching cart/i)).toBeInTheDocument();
    const appliesToSelect = screen.getByLabelText("Applies to") as HTMLSelectElement;
    const optionLabels = Array.from(appliesToSelect.options).map((o) => o.textContent);
    expect(optionLabels).not.toContain("All products");
  });

  it("submitting an auto discount sends discountType 'auto' and no code", async () => {
    const user = userEvent.setup();
    createDiscount.mockResolvedValue({});
    const onSaved = vi.fn();
    render(<DiscountFormModal discount={null} products={products} collections={collections} onClose={vi.fn()} onSaved={onSaved} />);

    await user.click(screen.getAllByRole("switch")[0]);
    await user.type(screen.getByLabelText(/value/i), "15");
    await user.selectOptions(screen.getByLabelText("Applies to"), "SPECIFIC_PRODUCTS");
    await user.selectOptions(screen.getByLabelText(/Products/i), ["1"]);
    await user.click(screen.getByRole("button", { name: /create discount/i }));

    await waitFor(() => expect(createDiscount).toHaveBeenCalled());
    const payload = createDiscount.mock.calls[0][0];
    expect(payload).toMatchObject({ discountType: "auto", code: undefined, appliesTo: "SPECIFIC_PRODUCTS", productIds: [1] });
  });

  it("editing an existing auto discount starts with the toggle off", () => {
    const discount = fixtureDiscount({
      code: null,
      discountType: "auto",
      appliesTo: "SPECIFIC_COLLECTIONS",
      collections: [{ id: 5, name: "Best Sellers" }],
    });
    render(<DiscountFormModal discount={discount} products={products} collections={collections} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
  });
});
