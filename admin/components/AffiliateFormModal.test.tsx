import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AffiliateFormModal from "./AffiliateFormModal";
import { ToastProvider } from "@/components/ui/Toast";
import type { AffiliateListItem } from "@/lib/types";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  createAffiliate: vi.fn(),
  updateAffiliate: vi.fn(),
}));

function fakeAffiliate(): AffiliateListItem {
  return {
    id: 1,
    name: "Jane Referrer",
    mobile: "0501234567",
    status: "active",
    createdAt: new Date().toISOString(),
    codesCount: 0,
    ordersCount: 0,
  };
}

function renderModal() {
  return render(
    <ToastProvider>
      <AffiliateFormModal affiliate={fakeAffiliate()} onClose={vi.fn()} onSaved={vi.fn()} />
    </ToastProvider>,
  );
}

describe("AffiliateFormModal — Status picker", () => {
  it("renders the Status picker as a Combobox, not a native select", () => {
    renderModal();
    expect(screen.getByRole("combobox")).toHaveTextContent("Active");
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("opens and selects a new status", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Inactive" }));

    expect(screen.getByRole("combobox")).toHaveTextContent("Inactive");
  });
});
