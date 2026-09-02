import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductTabsSettings from "./ProductTabsSettings";

vi.mock("@/lib/api", () => ({
  listCollections: () => Promise.resolve([{ id: 1, name: "Roses" }]),
  uploadThemeImage: vi.fn(),
  resolveImageUrl: (u: string) => u,
}));

// BackgroundControls (a shared child) calls useToast — irrelevant here,
// stubbed the same way HeaderSettings.test.tsx does.
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

describe("ProductTabsSettings", () => {
  it("renders the tabs editor and the empty-state hint when there are no tabs", () => {
    render(<ProductTabsSettings settings={{}} onUpdate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /add tab/i })).toBeInTheDocument();
    expect(screen.getByText(/at least one tab with a label and a collection/i)).toBeInTheDocument();
  });

  it("'Add tab' appends a blank tab via onUpdate('tabs', ...)", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<ProductTabsSettings settings={{ tabs: [] }} onUpdate={onUpdate} />);
    await user.click(screen.getByRole("button", { name: /add tab/i }));
    expect(onUpdate).toHaveBeenCalledWith(
      "tabs",
      expect.arrayContaining([expect.objectContaining({ label: "", collectionId: 0 })]),
    );
  });

  it("renders an existing tab's label and a Columns control", () => {
    render(
      <ProductTabsSettings
        settings={{ tabs: [{ id: "t1", label: "Best Selling", collectionId: 1 }], columns: 4 }}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Best Selling")).toBeInTheDocument();
    expect(screen.getByLabelText("Columns")).toBeInTheDocument();
  });
});
