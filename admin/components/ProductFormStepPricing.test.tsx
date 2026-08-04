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
