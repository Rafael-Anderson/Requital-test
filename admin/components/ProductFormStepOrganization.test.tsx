import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductFormStepOrganization from "./ProductFormStepOrganization";
import { ToastProvider } from "@/components/ui/Toast";
import type { ProductFormState } from "@/lib/useProductForm";

afterEach(cleanup);

function renderStep(form: ProductFormState) {
  return render(
    <ToastProvider>
      <ProductFormStepOrganization form={form} hideFeatureSections />
    </ToastProvider>,
  );
}

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
    setCollections: vi.fn(),
    collectionIds: [],
    toggleCollection: vi.fn(),
    brands: [],
    setBrands: vi.fn(),
    brandId: null,
    taxClasses: [],
    taxClassId: null,
    setTaxClassId: vi.fn(),
    setBrandId: vi.fn(),
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
    metafields: { defs: [], drafts: {}, loading: false, setDraft: vi.fn() },
    ...overrides,
  } as unknown as ProductFormState;
}

// The Status control is deliberately a Combobox rather than a native <select>.
// Scoped to that one control rather than asserting the whole step contains no
// <select> at all: the Tax class picker IS a native Select, which is the
// documented default for a short option list (Combobox is for long/searchable
// ones), so a step-wide assertion would forbid the correct component.
function statusPicker() {
  const picker = screen
    .getAllByRole("combobox")
    .find((el) => el.textContent?.includes("Active"));
  expect(picker).toBeDefined();
  return picker!;
}

describe("ProductFormStepOrganization — Status picker", () => {
  it("renders the Status picker as a Combobox, not a native select", () => {
    renderStep(fakeForm());
    const picker = statusPicker();
    expect(picker).toHaveTextContent("Active");
    expect(picker.tagName).not.toBe("SELECT");
  });

  it("selecting a new status calls form.setStatus", async () => {
    const user = userEvent.setup();
    const setStatus = vi.fn();
    renderStep(fakeForm({ setStatus }));

    await user.click(statusPicker());
    await user.click(await screen.findByRole("option", { name: "Draft" }));

    expect(setStatus).toHaveBeenCalledWith("Unavailable");
  });
});

describe("ProductFormStepOrganization — Custom fields", () => {
  const def = (id: number, type: string, name: string, extra = {}) => ({
    id,
    ownerType: "product",
    namespace: "custom",
    key: `k${id}`,
    name,
    type,
    validation: null,
    displayOrder: 0,
    visibleOnStorefront: false,
    ...extra,
  });

  it("renders nothing for a shop with no product custom fields", () => {
    renderStep(fakeForm());
    expect(screen.queryByText("Custom fields")).not.toBeInTheDocument();
  });

  it("renders an input per definition and writes edits back through setDraft", async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    renderStep(
      fakeForm({
        metafields: {
          defs: [
            def(1, "text", "Care instructions"),
            def(2, "single_select", "Origin", { validation: { options: ["UAE", "NL"] } }),
          ],
          drafts: { 1: "", 2: "" },
          loading: false,
          setDraft,
        },
      } as unknown as Partial<ProductFormState>),
    );
    expect(screen.getByText("Custom fields")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Care instructions"), "x");
    expect(setDraft).toHaveBeenCalledWith(1, "x");
    expect(screen.getByRole("option", { name: "NL" })).toBeInTheDocument();
  });
});
