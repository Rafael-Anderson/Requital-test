import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TemplateForm from "./TemplateForm";
import { ToastProvider } from "@/components/ui/Toast";
import type { Collection, Product } from "@/lib/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const collections: Collection[] = [
  { id: 1, name: "Flowers", slug: "flowers", displayOrder: 0, image: null, isFeatured: false, parentCollectionId: null },
];
const products: Product[] = [
  { id: 1, name: "Rose Bouquet" } as Product,
  { id: 2, name: "Tulip Bundle" } as Product,
];

vi.mock("@/lib/api", () => ({
  resolveImageUrl: (path: string | null | undefined) => path || null,
  listCollections: vi.fn(),
  listProducts: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  setTemplateProducts: vi.fn(),
  setTemplateCollections: vi.fn(),
  uploadTemplateImage: vi.fn(),
}));

import { listCollections, listProducts } from "@/lib/api";

function renderForm() {
  vi.mocked(listCollections).mockResolvedValue(collections);
  vi.mocked(listProducts).mockResolvedValue(products);
  return render(
    <ToastProvider>
      <TemplateForm />
    </ToastProvider>,
  );
}

// Combobox.tsx's trigger has no htmlFor/aria-labelledby tying it to its
// <label> sibling (same as every other Combobox usage in this app), so
// getByLabelText can't find it — locate the label text, then look for the
// combobox within its wrapping div instead.
function getCombobox(labelText: string) {
  const container = screen.getByText(labelText).closest("div");
  return within(container as HTMLElement).getByRole("combobox");
}

describe("TemplateForm", () => {
  it("renders the Type picker as a Combobox, not a native select", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByText("Type")).toBeInTheDocument());
    const trigger = getCombobox("Type");
    expect(trigger.tagName).toBe("BUTTON");
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("opens the Type combobox on click and selects an option", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(screen.getByText("Type")).toBeInTheDocument());
    await user.click(getCombobox("Type"));
    const option = await screen.findByRole("option", { name: /Rule-based/ });
    await user.click(option);
    expect(getCombobox("Type")).toHaveTextContent("Rule-based");
  });

  it("populates the Collection combobox from listCollections once switched to rule-based", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(screen.getByText("Type")).toBeInTheDocument());
    await user.click(getCombobox("Type"));
    await user.click(await screen.findByRole("option", { name: /Rule-based/ }));

    await waitFor(() => expect(screen.getByText("Collection")).toBeInTheDocument());
    await user.click(getCombobox("Collection"));
    expect(await screen.findByRole("option", { name: "Flowers" })).toBeInTheDocument();
  });

  it("adds a product via the Add product combobox", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(screen.getByText("Add product")).toBeInTheDocument());
    await user.click(getCombobox("Add product"));
    await user.click(await screen.findByRole("option", { name: "Rose Bouquet" }));
    expect(getCombobox("Add product")).toHaveTextContent("Rose Bouquet");
    await user.click(screen.getByText("Add"));
    expect(screen.getByText("Rose Bouquet")).toBeInTheDocument();
  });
});
