import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import CategoriesPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import type { Collection } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listCollections: vi.fn(), deleteCollection: vi.fn(), reorderCollections: vi.fn() };
});
vi.mock("@/components/ProductsTabs", () => ({ default: () => null }));
vi.mock("@/components/ListImportButtons", () => ({ CollectionImportButton: () => null }));
vi.mock("@/components/CollectionFormModal", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/products/categories", useRouter: () => ({ push: vi.fn() }) }));
import { listCollections } from "@/lib/api";

const col = (id: number, name: string, parent: number | null, extra: Partial<Collection> = {}): Collection => ({
  id, name, slug: name.toLowerCase(), displayOrder: id, image: null, isFeatured: false,
  parentCollectionId: parent, description: null, collectionType: "manual", ...extra,
});

async function rows() {
  vi.mocked(listCollections).mockResolvedValue([
    col(1, "Flowers", null),
    col(2, "Roses", 1),
    col(3, "Red", 2),
    col(4, "Auto", null, { collectionType: "automated" }),
  ]);
  render(<ToastProvider><CategoriesPage /></ToastProvider>);
  await screen.findByText("Flowers");
  return screen.getAllByTestId("collection-row");
}

describe("collections list: tree guides sit in their own gutter", () => {
  it("one guide cell per nesting level, none for a top-level row", async () => {
    const r = await rows();
    expect(within(r[0]).queryByTestId("tree-gutter")).toBeNull();
    expect(within(r[1]).getByTestId("tree-gutter").children).toHaveLength(1);
    expect(within(r[2]).getByTestId("tree-gutter").children).toHaveLength(2);
  });

  it("the gutter is a SIBLING before the drag handle and the name, never an ancestor or overlay of them", async () => {
    const r = await rows();
    const gutter = within(r[2]).getByTestId("tree-gutter");
    const handle = r[2].querySelector("svg.lucide-grip-vertical") as SVGElement;
    const name = within(r[2]).getByText("Red");
    expect(gutter.contains(handle)).toBe(false);
    expect(gutter.contains(name)).toBe(false);
    expect(gutter.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gutter.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // guides are cells with a logical start border (mirrors in RTL), not an absolutely positioned overlay
    for (const cell of Array.from(gutter.children)) {
      expect((cell as HTMLElement).className).toContain("border-s");
      expect((cell as HTMLElement).className).not.toMatch(/\babsolute\b|\bborder-l\b|\bml-|\bpl-/);
    }
  });

  it("the old container-wide guide overlay (a ::before gradient behind every row) is gone", async () => {
    const r = await rows();
    const container = r[0].parentElement as HTMLElement;
    expect(container.className).not.toContain("before:");
    expect(container.getAttribute("style") ?? "").not.toContain("--tree-indent");
    for (const row of r) expect(row.className).not.toMatch(/\bpl-|\bpr-|\bml-|\bmr-/);
  });

  it("shows an Automated badge only on automated collections", async () => {
    const r = await rows();
    expect(within(r[3]).getByText("Automated")).toBeInTheDocument();
    expect(within(r[0]).queryByText("Automated")).toBeNull();
  });
});
