import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";
import ListImportModal, { type ListImportReport } from "./ListImportModal";
import {
  collectionReportToList,
  customerReportToList,
} from "@/lib/list-import-adapters";
import type { CollectionImportReport, CustomerImportReport } from "@/lib/types";

afterEach(cleanup);

const CUSTOMERS: CustomerImportReport = {
  source: "customers",
  onExisting: "skip",
  totals: { rows: 4, create: 1, update: 1, skip: 0, conflict: 1, error: 1 },
  rows: [
    {
      rowNumber: 3,
      name: "Bad",
      phoneMasked: null,
      action: "error",
      reason: null,
      changes: [],
      warnings: [],
      errors: ["Phone is not a valid number"],
    },
    {
      rowNumber: 4,
      name: "Twin",
      phoneMasked: "+971•••••••67",
      action: "conflict",
      reason:
        "Rows 4, 5 have the same phone number but different names or emails. None were imported. Fix the file.",
      changes: [],
      warnings: [],
      errors: [],
    },
    {
      rowNumber: 2,
      name: "Sara",
      phoneMasked: "+971•••••••67",
      action: "create",
      reason: null,
      changes: [],
      warnings: [],
      errors: [],
    },
    {
      rowNumber: 6,
      name: "Raw",
      phoneMasked: "+971•••••••77",
      action: "update",
      reason: null,
      changes: ["Email"],
      warnings: ["The existing name was kept"],
      errors: [],
    },
  ],
  truncated: false,
  warnings: [
    "The file has a marketing or subscription column. It was ignored: importing customers never subscribes anyone to anything.",
  ],
  unsupportedColumns: [],
  note: "Imported customers are not subscribed to anything and no email or message is sent to them.",
};

describe("report adapters", () => {
  it("maps customers: masked phone as the subtitle, conflicts kept, writable = create + update", () => {
    const list = customerReportToList(CUSTOMERS);
    expect(list.writable).toBe(2);
    expect(list.rows[1]).toMatchObject({
      action: "conflict",
      subtitle: "+971•••••••67",
    });
    expect(list.rows[3].details).toEqual(["Adds email"]);
    expect(list.summary).toBe(
      "1 to create, 1 to update, 0 unchanged, 1 conflicts, 1 with errors.",
    );
    expect(list.note).toMatch(/not subscribed/);
  });

  it("maps collections: change lines and the nesting level", () => {
    const report: CollectionImportReport = {
      source: "collections",
      onExisting: "update",
      totals: { rows: 2, create: 1, update: 1, skip: 0, error: 0 },
      rows: [
        {
          rowNumber: 2,
          name: "Leaf",
          action: "create",
          reason: null,
          changes: [],
          warnings: [],
          errors: [],
          depth: 2,
        },
        {
          rowNumber: 3,
          name: "Top",
          action: "update",
          reason: null,
          changes: [{ field: "Parent", from: null, to: "X" }],
          warnings: [],
          errors: [],
          depth: 0,
        },
      ],
      truncated: false,
      warnings: [],
      unsupportedColumns: ["Extra"],
    };
    const list = collectionReportToList(report);
    expect(list.rows[0].subtitle).toBe("level 3");
    expect(list.rows[1].details).toEqual(["Parent: empty to X"]);
    expect(list.warnings[0]).toMatch(/Extra/);
    expect(list.writable).toBe(2);
  });
});

function renderModal(
  over: Partial<React.ComponentProps<typeof ListImportModal>> = {},
) {
  const previewFn =
    vi.fn<(f: File, e: "update" | "skip") => Promise<ListImportReport>>();
  const confirmFn = vi.fn().mockResolvedValue("Imported: 1 created");
  const onImported = vi.fn();
  render(
    <ToastProvider>
      <ListImportModal
        title="Import customers"
        intro="Upload a file."
        existingLabel="Customers who already exist"
        previewFn={previewFn}
        confirmFn={confirmFn}
        onClose={() => {}}
        onImported={onImported}
        {...over}
      />
    </ToastProvider>,
  );
  return { previewFn, confirmFn, onImported };
}

describe("ListImportModal", () => {
  it("previews, lists errors and conflicts first, and confirms with the same choices", async () => {
    const user = userEvent.setup();
    const { previewFn, confirmFn, onImported } = renderModal();
    previewFn.mockResolvedValue(customerReportToList(CUSTOMERS));
    const file = new File(["name,phone"], "c.csv");
    await user.upload(
      document.querySelector("input[type=file]") as HTMLInputElement,
      file,
    );
    await user.selectOptions(
      screen.getByLabelText("Customers who already exist"),
      "update",
    );
    await user.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(previewFn).toHaveBeenCalledWith(file, "update"));
    expect(await screen.findByText(/1 to create, 1 to update/)).toBeTruthy();
    expect(screen.getByText(/never subscribes anyone/)).toBeTruthy();
    expect(screen.getByText(/no email or message is sent/)).toBeTruthy();
    await user.click(screen.getByText("Twin"));
    expect(screen.getByText(/None were imported/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Confirm import (2)" }),
    );
    await waitFor(() => expect(confirmFn).toHaveBeenCalledWith(file, "update"));
    expect(onImported).toHaveBeenCalled();
  });

  it("cannot confirm when nothing is writable, and drops a stale preview when a choice changes", async () => {
    const user = userEvent.setup();
    const { previewFn } = renderModal();
    previewFn.mockResolvedValue({
      ...customerReportToList(CUSTOMERS),
      writable: 0,
    });
    await user.upload(
      document.querySelector("input[type=file]") as HTMLInputElement,
      new File(["x"], "c.csv"),
    );
    await user.click(screen.getByRole("button", { name: "Preview" }));
    const confirm = await screen.findByRole("button", {
      name: "Confirm import (0)",
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(
      screen.getByLabelText("Customers who already exist"),
      "update",
    );
    expect(screen.queryByRole("button", { name: /Confirm import/ })).toBeNull();
  });

  it("shows the server's message when the file is refused", async () => {
    const user = userEvent.setup();
    const { previewFn } = renderModal();
    previewFn.mockRejectedValue(
      new Error(
        "This does not look like a customers file. Missing columns: name",
      ),
    );
    await user.upload(
      document.querySelector("input[type=file]") as HTMLInputElement,
      new File(["x"], "c.csv"),
    );
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText(/Missing columns: name/)).toBeTruthy();
  });
});
