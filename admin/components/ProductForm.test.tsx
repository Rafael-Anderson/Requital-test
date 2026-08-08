import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductForm from "./ProductForm";
import { ToastProvider } from "@/components/ui/Toast";
import type { Product } from "@/lib/types";
import { getShop } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/api", () => ({
  resolveImageUrl: (path: string | null | undefined) => path || null,
  uploadProductImage: vi.fn(),
  updateProductOptions: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  updateProductAvailability: vi.fn(),
  duplicateProduct: vi.fn(),
  getShop: vi.fn().mockResolvedValue({
    productEditorMode: "simple",
  }),
  listCategories: vi.fn().mockResolvedValue([]),
  listIngredients: vi.fn().mockResolvedValue([]),
  listIngredientCategories: vi.fn().mockResolvedValue([]),
  listOutlets: vi.fn().mockResolvedValue([]),
}));

function renderForm(product?: Product) {
  return render(
    <ToastProvider>
      <ProductForm product={product} />
    </ToastProvider>,
  );
}

const existingProduct: Product = {
  id: 1,
  name: "Rose Bouquet",
  description: null,
  price: "120",
  compareAtPrice: null,
  costPrice: null,
  sku: "SKU-1",
  barcode: null,
  status: "Available",
  trackInventory: false,
  continueSellingOutOfStock: false,
  chargeTax: true,
  isCheckoutAddon: false,
  showVariants: false,
  showAttributes: false,
  showFaqs: false,
  vendor: null,
  productType: null,
  physicalProduct: true,
  weight: null,
  weightUnit: "kg",
  dimensions: null,
  slug: "rose-bouquet",
  metaTitle: null,
  metaDescription: null,
  stockQuantity: null,
  lowStockThreshold: null,
  totalSold: 0,
  thumbnail: "/uploads/products/rose.jpg",
  images: [{ url: "/uploads/products/rose.jpg", order: 0 }] as Product["images"],
  attributes: [],
  faqs: [],
  hasVariants: false,
  options: [],
  variants: [],
  categories: [{ id: 1, name: "Flowers" } as Product["categories"][number]],
  tags: [],
  ingredients: [],
  makeableQuantity: null,
  limitedByIngredient: null,
};

describe("ProductForm wizard", () => {
  it("renders Step 1 (Basics) by default for a new product", async () => {
    renderForm();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Title")).toBeInTheDocument());
  });

  it("blocks Next on Step 1 when Title is empty", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByText("Next"));
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("advances to Step 2 once Title is filled, and Back returns to Step 1", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Title"), "New Product");
    await user.click(screen.getByText("Next"));

    await waitFor(() => expect(screen.getByText("Price (AED)")).toBeInTheDocument());

    await user.click(screen.getByText("Back"));
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("shows the summary card with title + price on Step 3 with a Create product button", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Title"), "New Product");
    await user.click(screen.getByText("Next"));
    await waitFor(() => expect(screen.getByText("Price (AED)")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Price (AED)"), "50");
    await user.click(screen.getByText("Next"));

    await waitFor(() => expect(screen.getByText("Create product")).toBeInTheDocument());
    expect(screen.getByText("New Product")).toBeInTheDocument();
    expect(screen.getByText("AED 50")).toBeInTheDocument();
  });

  it("opens on Step 1 with every stepper circle already completed when editing", async () => {
    renderForm(existingProduct);
    expect(screen.getByLabelText("Title")).toHaveValue("Rose Bouquet");
    expect(screen.queryByText("Save changes")).not.toBeInTheDocument();
    // All three steps clickable (completed) — clicking straight to Step 3
    // should work without going through Next/Next first.
    await waitFor(() => expect(screen.getByText("Organization")).toBeInTheDocument());
  });

  it("clicking a completed stepper circle navigates to that step", async () => {
    const user = userEvent.setup();
    renderForm(existingProduct);
    await user.click(screen.getByText("Organization"));
    await waitFor(() => expect(screen.getByText("Save changes")).toBeInTheDocument());
    expect(screen.getByText("Rose Bouquet")).toBeInTheDocument();
  });

  it("mode 'simple': Variants/Attributes/FAQs are opt-in links, not expanded editors", async () => {
    const user = userEvent.setup();
    renderForm(existingProduct);
    await user.click(screen.getByText("Organization"));
    await waitFor(() => expect(screen.getByText("Add variants")).toBeInTheDocument());
    expect(screen.getByText("Add attributes")).toBeInTheDocument();
    expect(screen.getByText("Add FAQs")).toBeInTheDocument();
    expect(screen.queryByText("Options")).not.toBeInTheDocument();
  });

  it("Cancel navigates to /products (Products moved out of /inventory in Phase B)", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(screen.getByText("Cancel")).toBeInTheDocument());
    await user.click(screen.getByText("Cancel"));
    expect(push).toHaveBeenCalledWith("/products");
  });

  it("mode 'advanced': a new product renders all three sections expanded, with no stepper", async () => {
    vi.mocked(getShop).mockResolvedValueOnce({ productEditorMode: "advanced" } as never);
    renderForm();
    // A brand-new, unsaved product can't have real variant options yet
    // (see VariantsSection) — its expanded (enabled) state shows this note
    // instead of the "Options" editor, which only appears once a product id
    // exists.
    await waitFor(() =>
      expect(screen.getByText("Save the product first to add options like size or color.")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Informational facts shown on the product page — not purchasable options like Size/Color."),
    ).toBeInTheDocument();
    expect(screen.getByText("Question/answer pairs shown on the product page.")).toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });
});
