import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";
import type { ShopifyImportReport } from "@/lib/types";
import ShopifyImportModal from "./ShopifyImportModal";

afterEach(cleanup);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listCollections: vi.fn(),
    listOutlets: vi.fn(),
    previewShopifyImport: vi.fn(),
    confirmShopifyImport: vi.fn(),
  };
});
import { confirmShopifyImport, listCollections, listOutlets, previewShopifyImport } from "@/lib/api";

const REPORT: ShopifyImportReport = {
  source: "shopify",
  currency: "AED",
  currencyNote: "Prices are imported exactly as exported and are read as AED.",
  outletId: 5,
  collectionId: 3,
  onExisting: "update",
  totals: { products: 2, create: 1, update: 1, skip: 0, error: 0, variants: 4, images: 3, stockUpdates: 2 },
  products: [
    {
      handle: "red-rose",
      rowNumber: 2,
      name: "Red Rose",
      action: "update",
      reason: null,
      changes: [{ field: "Price", from: "150", to: "160" }],
      variantChanges: [{ sku: "RRB-S", field: "Stock", from: "12", to: "20" }],
      variants: { total: 3, toCreate: 0, toUpdate: 3, notMatched: 0 },
      images: { total: 2, toAdd: 1, urls: [] },
      stockUpdates: 1,
      warnings: ["Description: unsupported HTML was removed (<script>)"],
      errors: [],
    },
    {
      handle: "vase",
      rowNumber: 6,
      name: "Vase",
      action: "create",
      reason: null,
      changes: [],
      variantChanges: [],
      variants: { total: 1, toCreate: 1, toUpdate: 0, notMatched: 0 },
      images: { total: 1, toAdd: 1, urls: [] },
      stockUpdates: 1,
      warnings: [],
      errors: [],
    },
  ],
  truncated: false,
  warnings: ["These columns have data but are not imported: Google Shopping / Gender."],
  unsupportedColumns: ["Google Shopping / Gender"],
};

beforeEach(() => {
  vi.mocked(listCollections).mockResolvedValue([{ id: 3, name: "Imported" }] as never);
  vi.mocked(listOutlets).mockResolvedValue([{ id: 5, name: "Main" }] as never);
  vi.mocked(previewShopifyImport).mockResolvedValue(REPORT);
  vi.mocked(confirmShopifyImport).mockResolvedValue({ created: 1, updated: 1, skipped: 0, errors: 0, report: REPORT });
});

describe("ShopifyImportModal", () => {
  it("previews with the chosen options, shows the diff, and confirms with the same options", async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    render(
      <ToastProvider>
        <ShopifyImportModal onClose={() => {}} onImported={onImported} />
      </ToastProvider>,
    );
    const file = new File(["Handle,Title\n"], "products.csv", { type: "text/csv" });
    await user.upload(document.querySelector("input[type=file]") as HTMLInputElement, file);
    await screen.findByRole("option", { name: "Imported" });
    await user.selectOptions(screen.getByLabelText("Put new products in"), "3");
    await user.selectOptions(screen.getByLabelText("Stock quantities go to"), "5");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() =>
      expect(previewShopifyImport).toHaveBeenCalledWith(file, { onExisting: "update", collectionId: 3, outletId: 5 }),
    );
    expect(await screen.findByText(/1 to create, 1 to update/)).toBeTruthy();
    expect(screen.getByText(/read as AED/)).toBeTruthy();
    expect(screen.getByText(/Google Shopping/)).toBeTruthy();
    await user.click(screen.getByText("Red Rose"));
    expect(screen.getByText(/150 to 160/)).toBeTruthy();
    expect(screen.getByText(/12 to 20/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Confirm import (2)" }));
    await waitFor(() =>
      expect(confirmShopifyImport).toHaveBeenCalledWith(file, { onExisting: "update", collectionId: 3, outletId: 5 }),
    );
    expect(onImported).toHaveBeenCalled();
  });

  it("discards a preview when an option changes, so confirm cannot run on stale choices", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ShopifyImportModal onClose={() => {}} onImported={() => {}} />
      </ToastProvider>,
    );
    await user.upload(document.querySelector("input[type=file]") as HTMLInputElement, new File(["x"], "p.csv"));
    await user.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText(/1 to create/);
    await user.selectOptions(screen.getByLabelText("Products that already exist"), "skip");
    expect(screen.queryByText(/1 to create/)).toBeNull();
    expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
  });

  it("shows the server's message when the file is rejected", async () => {
    vi.mocked(previewShopifyImport).mockRejectedValueOnce(new Error("This does not look like a Shopify product export"));
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ShopifyImportModal onClose={() => {}} onImported={() => {}} />
      </ToastProvider>,
    );
    await user.upload(document.querySelector("input[type=file]") as HTMLInputElement, new File(["x"], "p.csv"));
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText(/does not look like a Shopify/)).toBeTruthy();
  });
});
