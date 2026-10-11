import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MergeCustomersModal from "./MergeCustomersModal";
import { ToastProvider } from "@/components/ui/Toast";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({ listCustomers: vi.fn(), previewCustomerMerge: vi.fn(), mergeCustomers: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const dup = { id: 2, name: "Sara B", phone: "0501111111", email: null, createdAt: "", orderCount: 2, lifetimeValue: 10, lastOrderDate: null, tags: [] };

async function open() {
  vi.mocked(api.listCustomers).mockResolvedValue({ data: [{ ...dup, id: 1, name: "Self" }, dup], page: 1, pageSize: 10, total: 2 } as never);
  vi.mocked(api.previewCustomerMerge).mockResolvedValue({
    customers: [],
    willMove: { orders: 2, draftOrders: 0, storeCreditEntries: 1, notes: 0 },
  });
  const onMerged = vi.fn();
  render(
    <ToastProvider>
      <MergeCustomersModal primaryId={1} primaryName="Sara A" onClose={vi.fn()} onMerged={onMerged} />
    </ToastProvider>,
  );
  await userEvent.type(screen.getByLabelText(/Find customers/), "sara");
  await userEvent.click(await screen.findByLabelText(/Sara B/));
  return onMerged;
}

describe("MergeCustomersModal", () => {
  it("says it cannot be undone and never offers the customer itself", async () => {
    await open();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Self/)).not.toBeInTheDocument();
  });

  it("will not merge until the preview is shown AND MERGE is typed exactly", async () => {
    const onMerged = await open();
    expect(screen.queryByRole("button", { name: "Merge customers" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    const go = await screen.findByRole("button", { name: "Merge customers" });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Type MERGE to confirm"), "merge");
    expect(go).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Type MERGE to confirm"));
    await userEvent.type(screen.getByLabelText("Type MERGE to confirm"), "MERGE");
    expect(go).toBeEnabled();
    vi.mocked(api.mergeCustomers).mockResolvedValue({ primaryId: 1, merged: [], alreadyMerged: [] });
    await userEvent.click(go);
    await waitFor(() => expect(api.mergeCustomers).toHaveBeenCalledWith(1, [2]));
    expect(onMerged).toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.type(await screen.findByLabelText("Type MERGE to confirm"), "MERGE");
    vi.mocked(api.mergeCustomers).mockRejectedValue(new Error("Customer 2 has a storefront account"));
    await userEvent.click(screen.getByRole("button", { name: "Merge customers" }));
    expect(await screen.findByText(/storefront account/)).toBeInTheDocument();
  });
});
