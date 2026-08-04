import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CustomerDetailPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { getCustomer, getShop } from "@/lib/api";
import type { CustomerDetail } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getShop: vi.fn(),
  getCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { role: "admin" }, loading: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "1" }),
}));

const customer: CustomerDetail = {
  id: 1,
  name: "Sara Ahmed",
  phone: "+971500000000",
  email: "sara@example.com",
  birthday: "1990-01-01",
  createdAt: new Date().toISOString(),
  orderCount: 3,
  lifetimeValue: 450,
  firstOrderDate: null,
  lastOrderDate: null,
  orders: [],
};

function renderPage() {
  return render(
    <ToastProvider>
      <CustomerDetailPage />
    </ToastProvider>,
  );
}

describe("CustomerDetailPage — simple/advanced mode", () => {
  it("simple mode: hides the stat card row", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(getCustomer).mockResolvedValue(customer);
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    expect(screen.queryByText("Lifetime Value")).not.toBeInTheDocument();
    expect(screen.queryByText("First Order")).not.toBeInTheDocument();
  });

  it("simple mode: hides the Birthday field", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(getCustomer).mockResolvedValue(customer);
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    expect(screen.queryByLabelText("Birthday")).not.toBeInTheDocument();
  });

  it("simple mode: still shows Name/Phone/Email and order history", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "simple" } as never);
    vi.mocked(getCustomer).mockResolvedValue(customer);
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByText("Order history")).toBeInTheDocument();
  });

  it("advanced mode: shows the stat card row", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(getCustomer).mockResolvedValue(customer);
    renderPage();

    await waitFor(() => expect(screen.getByText("Lifetime Value")).toBeInTheDocument());
    expect(screen.getByText("First Order")).toBeInTheDocument();
  });

  it("advanced mode: shows the Birthday field", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(getCustomer).mockResolvedValue(customer);
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Birthday")).toBeInTheDocument());
  });

  it("advanced mode: still shows order history", async () => {
    vi.mocked(getShop).mockResolvedValue({ productEditorMode: "advanced" } as never);
    vi.mocked(getCustomer).mockResolvedValue(customer);
    renderPage();

    await waitFor(() => expect(screen.getByText("Order history")).toBeInTheDocument());
  });
});
