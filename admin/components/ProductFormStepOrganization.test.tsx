import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductFormStepOrganization from "./ProductFormStepOrganization";
import type { ProductFormState } from "@/lib/useProductForm";

afterEach(cleanup);

function fakeForm(overrides: Partial<ProductFormState> = {}): ProductFormState {
  return {
    name: "Rose Bouquet",
    price: "50",
    status: "Available",
    setStatus: vi.fn(),
    vendor: "",
    setVendor: vi.fn(),
    productType: "",
    setProductType: vi.fn(),
    tags: [],
    tagDraft: "",
    setTagDraft: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    slug: "rose-bouquet",
    setSlug: vi.fn(),
    metaTitle: "",
    setMetaTitle: vi.fn(),
    metaDescription: "",
    setMetaDescription: vi.fn(),
    collections: [],
    collectionIds: [],
    toggleCollection: vi.fn(),
    images: [],
    setImages: vi.fn(),
    isEdit: false,
    product: null,
    setProduct: vi.fn(),
    productEditorMode: "simple",
    showVariants: false,
    setShowVariants: vi.fn(),
    showAttributes: false,
    setShowAttributes: vi.fn(),
    showFaqs: false,
    setShowFaqs: vi.fn(),
    attributes: [],
    setAttributes: vi.fn(),
    faqs: [],
    setFaqs: vi.fn(),
    additionalInfo: [],
    setAdditionalInfo: vi.fn(),
    fieldErrors: {},
    ...overrides,
  } as unknown as ProductFormState;
}

describe("ProductFormStepOrganization — Status picker", () => {
  it("renders the Status picker as a Combobox, not a native select", () => {
    render(<ProductFormStepOrganization form={fakeForm()} hideFeatureSections />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Active");
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("selecting a new status calls form.setStatus", async () => {
    const user = userEvent.setup();
    const setStatus = vi.fn();
    render(<ProductFormStepOrganization form={fakeForm({ setStatus })} hideFeatureSections />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Draft" }));

    expect(setStatus).toHaveBeenCalledWith("Unavailable");
  });
});
