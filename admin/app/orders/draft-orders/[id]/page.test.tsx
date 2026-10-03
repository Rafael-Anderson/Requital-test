import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DraftOrderDetailPage from "./page";
import { ToastProvider } from "@/components/ui/Toast";
import { getDraftOrder } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getDraftOrder: vi.fn(),
  cancelDraftOrder: vi.fn(),
  completeDraftOrder: vi.fn(),
  sendDraftOrderInvoice: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "5" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/DraftOrderBuilder", () => ({ default: () => null }));

describe("DraftOrderDetailPage", () => {
  it("a failed load shows the error and no skeleton (it used to load forever)", async () => {
    vi.mocked(getDraftOrder).mockRejectedValue(new Error("Draft order not found"));
    const { container } = render(
      <ToastProvider>
        <DraftOrderDetailPage />
      </ToastProvider>,
    );
    expect(await screen.findByText("Draft order not found")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  it("shows the skeleton while it is still loading", () => {
    vi.mocked(getDraftOrder).mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <ToastProvider>
        <DraftOrderDetailPage />
      </ToastProvider>,
    );
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});
