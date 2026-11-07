import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import CollectionConditions, { newConditionKey, type ConditionDraft } from "./CollectionConditions";
import CollectionFormModal from "./CollectionFormModal";
import { ToastProvider } from "@/components/ui/Toast";
import type { Collection } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    previewCollectionRules: vi.fn(),
    createCollection: vi.fn(),
    updateCollection: vi.fn(),
    uploadCollectionImage: vi.fn(),
  };
});
vi.mock("@/lib/useMetafieldEditor", () => ({
  useMetafieldEditor: () => ({ validate: () => null, save: async () => {} }),
}));
vi.mock("@/components/MetafieldsFields", () => ({ MetafieldsSection: () => null }));
vi.mock("@/lib/useShopCurrency", () => ({ useShopCurrency: () => "AED" }));
import { createCollection, previewCollectionRules, updateCollection } from "@/lib/api";

const preview = (total: number, names: string[] = []) => ({
  total,
  page: 1,
  pageSize: 10,
  products: names.map((name, i) => ({ id: i + 1, name, price: "10.00", status: "Available", thumbnail: null })),
});

const manual: Collection = {
  id: 1, name: "Flowers", slug: "flowers", displayOrder: 0, image: null, isFeatured: false,
  parentCollectionId: null, description: null, collectionType: "manual", matchMode: "all", rules: [],
};

function Harness({ initial }: { initial: ConditionDraft[] }) {
  const [mode, setMode] = useState<"all" | "any">("all");
  const [conds, setConds] = useState(initial);
  return (
    <CollectionConditions
      matchMode={mode}
      onMatchModeChange={setMode}
      conditions={conds}
      onConditionsChange={setConds}
      manualCollections={[manual]}
      currency="AED"
    />
  );
}
const cond = (field: string, operator: string, value: string): ConditionDraft => ({ key: newConditionKey(), field, operator, value });

describe("CollectionConditions", () => {
  it("shows the live match count and the matching products", async () => {
    vi.mocked(previewCollectionRules).mockResolvedValue(preview(2, ["Red Rose", "Tulip"]));
    render(<Harness initial={[cond("title", "contains", "rose")]} />);
    await waitFor(() => expect(screen.getByTestId("match-count")).toHaveTextContent("2 products match"));
    expect(screen.getByText("Red Rose")).toBeInTheDocument();
    expect(previewCollectionRules).toHaveBeenLastCalledWith(
      expect.objectContaining({ matchMode: "all", rules: [{ field: "title", operator: "contains", value: "rose" }] }),
    );
  });

  it("does not ask the server while a condition is incomplete or not a number", async () => {
    vi.mocked(previewCollectionRules).mockClear();
    render(<Harness initial={[cond("price", "gt", "abc")]} />);
    expect(screen.getByText("Complete every condition to see which products match.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 600));
    expect(previewCollectionRules).not.toHaveBeenCalled();
  });

  it("offers text operators for text attributes and only number operators for numbers", () => {
    render(<Harness initial={[cond("title", "contains", "x"), cond("price", "gt", "5")]} />);
    const rows = screen.getAllByTestId("condition-row");
    const textOps = within(rows[0]).getByLabelText("Comparison");
    expect(within(textOps).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "is equal to", "is not equal to", "starts with", "ends with", "contains", "does not contain",
    ]);
    const numOps = within(rows[1]).getByLabelText("Comparison");
    expect(within(numOps).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "is equal to", "is not equal to", "is greater than", "is less than",
    ]);
  });

  it("compare at price also offers is set / is not set, which take no value", async () => {
    vi.mocked(previewCollectionRules).mockResolvedValue(preview(0));
    render(<Harness initial={[cond("compare_at_price", "is_set", "")]} />);
    const row = screen.getByTestId("condition-row");
    expect(within(row).getByLabelText("Comparison")).toHaveValue("is_set");
    expect(within(row).queryByLabelText("Value")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("match-count")).toHaveTextContent("0 products match"));
  });

  it("adds a condition from the searchable attribute list and removes one", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCollectionRules).mockResolvedValue(preview(0));
    render(<Harness initial={[]} />);
    expect(screen.getByText(/No conditions yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add condition/ }));
    await user.click(screen.getAllByRole("combobox").at(-1)!);
    await user.click(await screen.findByRole("option", { name: "Tag" }));
    const row = await screen.findByTestId("condition-row");
    expect(within(row).getByLabelText("Attribute")).toHaveValue("tag");
    await user.click(screen.getByRole("button", { name: "Remove condition 1" }));
    expect(screen.queryByTestId("condition-row")).not.toBeInTheDocument();
  });
});

describe("CollectionFormModal: collection type", () => {
  function open(collection: Collection | null) {
    return render(
      <ToastProvider>
        <CollectionFormModal collection={collection} collections={[manual]} onClose={vi.fn()} onSaved={vi.fn()} />
      </ToastProvider>,
    );
  }

  it("a new collection is Manual by default: no conditions editor, payload says manual and sends no rules", async () => {
    const user = userEvent.setup();
    vi.mocked(createCollection).mockResolvedValue({ ...manual, id: 9 });
    open(null);
    expect(screen.queryByText("Products must match")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Roses");
    await user.click(screen.getByRole("button", { name: "Create collection" }));
    await waitFor(() => expect(createCollection).toHaveBeenCalled());
    const payload = vi.mocked(createCollection).mock.calls.at(-1)![0];
    expect(payload.collectionType).toBe("manual");
    expect(payload.rules).toBeUndefined();
  });

  it("Automated shows the editor and saves the conditions with the match mode", async () => {
    const user = userEvent.setup();
    vi.mocked(createCollection).mockResolvedValue({ ...manual, id: 10 });
    vi.mocked(previewCollectionRules).mockResolvedValue(preview(1, ["Red Rose"]));
    open(null);
    await user.type(screen.getByLabelText("Name"), "Roses");
    await user.click(screen.getByRole("button", { name: "Automated" }));
    expect(screen.getByText("Products must match")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "any condition" }));
    await user.click(screen.getByRole("button", { name: /Add condition/ }));
    await user.click(screen.getAllByRole("combobox").at(-1)!);
    await user.click(await screen.findByRole("option", { name: "Title" }));
    await user.type(await screen.findByLabelText("Value"), "rose");
    await user.click(screen.getByRole("button", { name: "Create collection" }));
    await waitFor(() => expect(createCollection).toHaveBeenCalled());
    const payload = vi.mocked(createCollection).mock.calls.at(-1)![0];
    expect(payload).toMatchObject({
      collectionType: "automated",
      matchMode: "any",
      rules: [{ field: "title", operator: "equals", value: "rose" }],
    });
  });

  it("refuses to save an automated collection with no conditions", async () => {
    const user = userEvent.setup();
    vi.mocked(createCollection).mockClear();
    open(null);
    await user.type(screen.getByLabelText("Name"), "Empty");
    await user.click(screen.getByRole("button", { name: "Automated" }));
    await user.click(screen.getByRole("button", { name: "Create collection" }));
    expect(createCollection).not.toHaveBeenCalled();
    expect(await screen.findByText(/Add at least one condition/)).toBeInTheDocument();
  });

  it("editing an automated collection loads its saved conditions", async () => {
    vi.mocked(previewCollectionRules).mockResolvedValue(preview(3));
    vi.mocked(updateCollection).mockResolvedValue(manual);
    open({
      ...manual, id: 4, name: "Cheap", collectionType: "automated", matchMode: "all",
      rules: [{ field: "price", operator: "lt", value: "50" }],
    });
    const row = await screen.findByTestId("condition-row");
    expect(within(row).getByLabelText("Attribute")).toHaveValue("price");
    expect(within(row).getByLabelText("Value")).toHaveValue("50");
    await waitFor(() => expect(screen.getByTestId("match-count")).toHaveTextContent("3 products match"));
  });
});
