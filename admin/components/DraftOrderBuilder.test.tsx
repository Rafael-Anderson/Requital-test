import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DraftOrderBuilder from "./DraftOrderBuilder";
import { ToastProvider } from "@/components/ui/Toast";
import type { Outlet, Product } from "@/lib/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const outlets: Outlet[] = [
  { id: 1, name: "Main Branch" } as Outlet,
  { id: 2, name: "Downtown Branch" } as Outlet,
];
const products: Product[] = [{ id: 1, name: "Rose Bouquet", hasVariants: false, price: "120" } as Product];

vi.mock("@/lib/api", () => ({
  listOutlets: vi.fn(),
  listProducts: vi.fn(),
  validateDiscount: vi.fn(),
  createDraftOrder: vi.fn(),
  updateDraftOrder: vi.fn(),
}));

import { listOutlets, listProducts } from "@/lib/api";

function renderBuilder() {
  vi.mocked(listOutlets).mockResolvedValue(outlets);
  vi.mocked(listProducts).mockResolvedValue(products);
  return render(
    <ToastProvider>
      <DraftOrderBuilder />
    </ToastProvider>,
  );
}

// Same trigger-has-no-label-association caveat as TemplateForm.test.tsx.
function getCombobox(labelText: string) {
  const container = screen.getByText(labelText).closest("div");
  return within(container as HTMLElement).getByRole("combobox");
}

describe("DraftOrderBuilder", () => {
  it("renders Emirate/Branch/Order type/Product pickers as Comboboxes, not native selects", async () => {
    renderBuilder();
    await waitFor(() => expect(getCombobox("Branch")).toBeInTheDocument());
    expect(getCombobox("Emirate")).toBeInTheDocument();
    expect(getCombobox("Order type")).toBeInTheDocument();
    expect(getCombobox("Product")).toBeInTheDocument();
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("opens the Emirate combobox and selects an option", async () => {
    const user = userEvent.setup();
    renderBuilder();
    await waitFor(() => expect(getCombobox("Branch")).toBeInTheDocument());
    await user.click(getCombobox("Emirate"));
    const option = await screen.findByRole("option", { name: "Sharjah" });
    await user.click(option);
    expect(getCombobox("Emirate")).toHaveTextContent("Sharjah");
  });

  it("Branch combobox is populated from listOutlets and defaults to the first outlet", async () => {
    renderBuilder();
    await waitFor(() => expect(getCombobox("Branch")).toHaveTextContent("Main Branch"));
    const user = userEvent.setup();
    await user.click(getCombobox("Branch"));
    await user.click(await screen.findByRole("option", { name: "Downtown Branch" }));
    expect(getCombobox("Branch")).toHaveTextContent("Downtown Branch");
  });

  it("adds an item via the Product combobox", async () => {
    const user = userEvent.setup();
    renderBuilder();
    await waitFor(() => expect(getCombobox("Product")).toBeInTheDocument());
    await user.click(getCombobox("Product"));
    await user.click(await screen.findByRole("option", { name: "Rose Bouquet" }));
    expect(getCombobox("Product")).toHaveTextContent("Rose Bouquet");
    await user.click(screen.getByText("Add"));
    expect(screen.getByText("Rose Bouquet")).toBeInTheDocument();
  });
});
