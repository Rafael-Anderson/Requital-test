import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CustomersPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { getShop, listCustomers } from "@/lib/api";
import type { CustomerListItem } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
  listCustomers: vi.fn(),
  listCustomerTags: vi.fn().mockResolvedValue([]),
  listCustomerSegments: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { role: "admin" }, loading: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // The page renders CustomersTabs, and the shared Tabs component reads the
  // current path to decide which tab is active.
  usePathname: () => "/customers",
}));

const customer: CustomerListItem = {
  id: 1,
  name: "Sara Ahmed",
  phone: "+971500000000",
  email: "sara@example.com",
  createdAt: new Date().toISOString(),
  orderCount: 3,
  lifetimeValue: 450,
  lastOrderDate: null,
  tags: [],
};

function renderPage() {
  return render(
    <ToastProvider>
      <CustomersPage />
    </ToastProvider>,
  );
}

// Each row renders twice (a card list below md, the table from md up); jsdom applies
// no CSS, so the queries below accept either.
describe("CustomersPage — simple/advanced mode", () => {
  it("simple mode: shows an Email column and no selection checkboxes", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(listCustomers).mockResolvedValue({ data: [customer], total: 1, page: 1, pageSize: 20 } as never);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Sara Ahmed").length).toBeGreaterThan(0));
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getAllByText("sara@example.com").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Select all customers")).not.toBeInTheDocument();
  });

  it("simple mode: hides the bulk action bar", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(listCustomers).mockResolvedValue({ data: [customer], total: 1, page: 1, pageSize: 20 } as never);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Sara Ahmed").length).toBeGreaterThan(0));
    expect(screen.queryByText("Export CSV")).not.toBeInTheDocument();
  });

  it("advanced mode: no Email column, selection checkboxes present", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(listCustomers).mockResolvedValue({ data: [customer], total: 1, page: 1, pageSize: 20 } as never);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Sara Ahmed").length).toBeGreaterThan(0));
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Select all customers").length).toBeGreaterThan(0);
  });

  it("advanced mode: bulk action bar appears once a row is selected", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(listCustomers).mockResolvedValue({ data: [customer], total: 1, page: 1, pageSize: 20 } as never);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Sara Ahmed").length).toBeGreaterThan(0));
    screen.getAllByLabelText("Select Sara Ahmed")[0].click();
    await waitFor(() => expect(screen.getByText("Export CSV")).toBeInTheDocument());
  });

  it("simple mode: column header count stays 6 (5 sortable + Email)", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(listCustomers).mockResolvedValue({ data: [customer], total: 1, page: 1, pageSize: 20 } as never);
    renderPage();

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(6));
  });

  it("advanced mode: column header count stays 6 (1 checkbox + 5 sortable)", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(listCustomers).mockResolvedValue({ data: [customer], total: 1, page: 1, pageSize: 20 } as never);
    renderPage();

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(6));
  });
});
