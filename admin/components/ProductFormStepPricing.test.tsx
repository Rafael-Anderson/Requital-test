import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductFormStepPricing from "./ProductFormStepPricing";
import type { ProductFormState } from "@/lib/useProductForm";

afterEach(cleanup);

function fakeForm(overrides: Partial<ProductFormState> = {}): ProductFormState {
  return {
    product: null,
    price: "50",
    setPrice: vi.fn(),
    compareAtPrice: "",
    setCompareAtPrice: vi.fn(),
    costPrice: "",
    setCostPrice: vi.fn(),
    sku: "SKU-1",
    setSku: vi.fn(),
    barcode: "",
    setBarcode: vi.fn(),
    chargeTax: true,
    setChargeTax: vi.fn(),
    isCheckoutAddon: false,
    setIsCheckoutAddon: vi.fn(),
    trackInventory: false,
    setTrackInventory: vi.fn(),
    continueSellingOutOfStock: false,
    setContinueSellingOutOfStock: vi.fn(),
    stockRows: [],
    stockValues: {},
    setStockValues: vi.fn(),
    ingredientsList: [],
    ingredientCategories: [],
    recipeRows: [],
    setRecipeRows: vi.fn(),
    physicalProduct: true,
    setPhysicalProduct: vi.fn(),
    weight: "",
    setWeight: vi.fn(),
    weightUnit: "kg",
    setWeightUnit: vi.fn(),
    dimensions: "",
    setDimensions: vi.fn(),
    isGiftCard: false,
    giftCardDenominations: [],
    denominationDraft: "",
    setDenominationDraft: vi.fn(),
    addDenomination: vi.fn(),
    removeDenomination: vi.fn(),
    deliveryTimeOverride: false,
    setDeliveryTimeOverride: vi.fn(),
    deliveryTimeValue: 30,
    setDeliveryTimeValue: vi.fn(),
    deliveryTimeUnit: "minutes",
    setDeliveryTimeUnit: vi.fn(),
    fieldErrors: {},
    ...overrides,
  } as unknown as ProductFormState;
}

describe("ProductFormStepPricing — weight unit picker", () => {
  it("renders the Unit picker as a Combobox, not a native select", () => {
    render(<ProductFormStepPricing form={fakeForm()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("kg");
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("selecting a new unit calls form.setWeightUnit", async () => {
    const user = userEvent.setup();
    const setWeightUnit = vi.fn();
    render(<ProductFormStepPricing form={fakeForm({ setWeightUnit })} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "g" }));

    expect(setWeightUnit).toHaveBeenCalledWith("g");
  });
});

describe("ProductFormStepPricing — estimated delivery time override", () => {
  it("defaults to off (inherit the shop default) and hides the preset picker for a product with no override", () => {
    render(<ProductFormStepPricing form={fakeForm()} />);
    expect(screen.getByText("Override the shop's estimated delivery time for this product")).toBeInTheDocument();
    expect(screen.queryByLabelText("Delivery time")).not.toBeInTheDocument();
  });

  it("toggling it on reveals the preset picker", async () => {
    // Toggle has no accessible name (role="switch", no label association) —
    // same positional-index query DiscountFormModal.test.tsx/ProductForm.test.tsx
    // already use. Default fakeForm order: gift card, charge tax, checkout
    // add-on, track inventory, then this one — index 4.
    const user = userEvent.setup();
    const setDeliveryTimeOverride = vi.fn();
    render(<ProductFormStepPricing form={fakeForm({ setDeliveryTimeOverride })} />);

    await user.click(screen.getAllByRole("switch")[4]);
    expect(setDeliveryTimeOverride).toHaveBeenCalledWith(true);
  });

  it("shows the matching preset selected for a stored value/unit pair", () => {
    render(
      <ProductFormStepPricing
        form={fakeForm({ deliveryTimeOverride: true, deliveryTimeValue: 1, deliveryTimeUnit: "days" })}
      />,
    );
    expect(screen.getByLabelText("Delivery time")).toHaveValue("1-days");
    expect(screen.queryByLabelText("Value")).not.toBeInTheDocument();
  });

  it("selecting a preset calls setDeliveryTimeValue/setDeliveryTimeUnit", async () => {
    const user = userEvent.setup();
    const setDeliveryTimeValue = vi.fn();
    const setDeliveryTimeUnit = vi.fn();
    render(
      <ProductFormStepPricing
        form={fakeForm({ deliveryTimeOverride: true, setDeliveryTimeValue, setDeliveryTimeUnit })}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Delivery time"), "Next day");

    expect(setDeliveryTimeValue).toHaveBeenCalledWith(1);
    expect(setDeliveryTimeUnit).toHaveBeenCalledWith("days");
  });

  it("a value/unit pair not matching any preset reveals the custom inputs", () => {
    render(
      <ProductFormStepPricing
        form={fakeForm({ deliveryTimeOverride: true, deliveryTimeValue: 45, deliveryTimeUnit: "minutes" })}
      />,
    );
    expect(screen.getByLabelText("Delivery time")).toHaveValue("custom");
    expect(screen.getByLabelText("Value")).toHaveValue(45);
    expect(screen.getByLabelText("Unit")).toHaveValue("minutes");
  });

  it("is not offered at all for a gift card", () => {
    render(<ProductFormStepPricing form={fakeForm({ isGiftCard: true })} />);
    expect(screen.queryByText("Override the shop's estimated delivery time for this product")).not.toBeInTheDocument();
  });
});
