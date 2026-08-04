import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";
import PolicyPagesSettingsPage from "./page";

afterEach(cleanup);

vi.mock("@/lib/api", () => ({
  getPolicyPages: vi.fn(),
  updatePolicyPage: vi.fn(),
}));
import { getPolicyPages, updatePolicyPage } from "@/lib/api";

const ALL_TYPES = ["TERMS", "PRIVACY", "REFUND", "PAYMENT", "SHIPPING"] as const;

function allPages(overrides: Partial<Record<(typeof ALL_TYPES)[number], string>> = {}) {
  return ALL_TYPES.map((type) => ({
    type,
    content: overrides[type] ?? "",
    updatedAt: overrides[type] ? "2026-01-01T00:00:00.000Z" : null,
  }));
}

describe("PolicyPagesSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a nav entry for all 5 fixed policy types", async () => {
    vi.mocked(getPolicyPages).mockResolvedValue(allPages({ TERMS: "<p>Terms content</p>" }));
    render(
      <ToastProvider>
        <PolicyPagesSettingsPage />
      </ToastProvider>,
    );

    for (const label of ["Terms & Conditions", "Privacy Policy", "Refund & Return Policy", "Payment Policy", "Shipping & Delivery Policy"]) {
      await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
    }
  });

  it("save calls updatePolicyPage with the selected type and edited content", async () => {
    const user = userEvent.setup();
    vi.mocked(getPolicyPages).mockResolvedValue(allPages());
    vi.mocked(updatePolicyPage).mockResolvedValue({
      type: "TERMS",
      content: "<p>Updated</p>",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    render(
      <ToastProvider>
        <PolicyPagesSettingsPage />
      </ToastProvider>,
    );

    await waitFor(() => expect(screen.getAllByText("Terms & Conditions").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(updatePolicyPage).toHaveBeenCalledWith("TERMS", "");
    });
  });
});
